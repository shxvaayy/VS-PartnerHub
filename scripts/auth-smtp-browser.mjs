import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// This acceptance test runs the real application with demo mode disabled and an
// authenticated SMTP server bound to loopback. It never contacts a public inbox.
const temporary = await mkdtemp(path.join(tmpdir(), "partnerhub-auth-smtp-"));
const artifacts = path.resolve("artifacts/local-verification/auth-smtp");
await mkdir(artifacts, { recursive: true });
const password = `Browser${randomBytes(16).toString("hex")}1!`;
const replacement = `Changed${randomBytes(16).toString("hex")}2!`;
const smtpPassword = randomBytes(24).toString("hex");
const received = [],
  checks = [];
let authenticationCount = 0,
  browser,
  app,
  db,
  page;
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS"],
  allowInsecureAuth: true,
  onAuth(auth, _session, callback) {
    if (auth.username !== "auth-qa" || auth.password !== smtpPassword)
      return callback(new Error("Invalid QA SMTP credentials"));
    authenticationCount++;
    callback(null, { user: "auth-qa" });
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => {
      received.push({
        to: session.envelope.rcptTo.map((r) => r.address),
        body: Buffer.concat(chunks)
          .toString()
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9a-f]{2})/gi, (_, value) =>
            String.fromCharCode(parseInt(value, 16)),
          ),
      });
      callback();
    });
  },
});
await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));
Object.assign(process.env, {
  NODE_ENV: "test",
  DEMO_MODE: "false",
  DATABASE_URL: "",
  SETUP_TOKEN: "",
  SQLITE_PATH: path.join(temporary, "accounts.sqlite"),
  UPLOAD_DIR: path.join(temporary, "uploads"),
  SESSION_SECRET: randomBytes(32).toString("hex"),
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  APP_URL: "http://127.0.0.1",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(smtp.server.address().port),
  SMTP_SECURE: "false",
  SMTP_USER: "auth-qa",
  SMTP_PASSWORD: smtpPassword,
  MAIL_FROM: "VS PartnerHub QA <no-reply@qa.example>",
  RESEND_API_KEY: "",
  GEMINI_API_KEY: "",
});
function passed(name) {
  checks.push({ name, passed: true });
  console.log(`Passed: ${name}`);
}
async function mailSince(index, fragment) {
  await expect
    .poll(
      () =>
        received
          .slice(index)
          .find(
            (mail) =>
              mail.to.includes("partner@qa.example") &&
              mail.body.includes(fragment),
          ),
      { timeout: 20000 },
    )
    .toBeTruthy();
  return received
    .slice(index)
    .find(
      (mail) =>
        mail.to.includes("partner@qa.example") && mail.body.includes(fragment),
    );
}
async function accessibility(name) {
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    `${name} accessibility`,
  );
}
try {
  ({ db } = await import("../server/db.ts"));
  await (await import("../server/db.ts")).migrate();
  await (await import("../server/seed.ts")).ensureInternalOrganization();
  const { config } = await import("../server/config.ts");
  const application = (await import("../server/app.ts")).createApp();
  app = await new Promise((resolve) => {
    const server = application.listen(0, "127.0.0.1", () => resolve(server));
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  config.appUrl = base;
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : "chrome",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  await page.goto(`${base}/setup`);
  for (const [name, value] of Object.entries({
    name: "SMTP QA Administrator",
    email: "admin@qa.example",
    password,
    confirm: password,
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page).toHaveURL(`${base}/app/integrations`);
  await page
    .getByRole("button", { name: "Verify connection", exact: true })
    .click();
  await expect(page.locator(".connection-result")).toContainText("verified");
  assert.ok(authenticationCount > 0);
  passed("Fresh installation and authenticated SMTP connection");
  await page
    .getByLabel("Test recipient", { exact: true })
    .fill("partner@qa.example");
  await page
    .getByRole("button", { name: "Send test email", exact: true })
    .click();
  await expect(page.locator(".connection-result")).toContainText("sent");
  assert.ok(received.some((mail) => mail.to.includes("partner@qa.example")));
  passed("Test email travels through SMTP and provider acceptance is recorded");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${base}/login`);
  await page.goto(`${base}/register?type=vendor`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, value] of Object.entries({
    name: "SMTP QA Partner",
    email: "partner@qa.example",
    password,
    confirm_password: password,
    contact_phone: "+91 9000000011",
  }))
    await page.locator(`form [name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, value] of Object.entries({
    legal_name: "SMTP Acceptance Company",
    city: "Pune",
    address: "QA Technology Park",
  }))
    await page.locator(`form [name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, value] of Object.entries({
    description: "A disposable organization for real SMTP acceptance testing.",
    capabilities: "Enterprise software",
    locations: "Pune",
    services: "Software delivery",
  }))
    await page.locator(`form [name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const category of ["PAN", "Incorporation"])
    await page
      .getByLabel(`Upload ${category}`, { exact: true })
      .setInputFiles("e2e/fixtures/company.pdf");
  await page.locator('[name="accept_terms"]').check();
  let offset = received.length;
  const registrationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/register") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create your partner account" })
    .click();
  const registration = await (await registrationResponse).json();
  assert.equal(registration.verificationCode, undefined);
  await expect(page).toHaveURL(`${base}/verify`);
  await expect(page.locator(".dev-code")).toHaveCount(0);
  await accessibility("Email verification");
  await page.screenshot({
    path: path.join(artifacts, "email-verification.png"),
  });
  const welcome = await mailSince(offset, "verification code is");
  const code = welcome.body.match(/verification code is (\d{6})/)[1];
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText("incorrect");
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(`${base}/app`);
  assert.equal(
    Boolean(
      (await db("users").where({ email: "partner@qa.example" }).first())
        .email_verified,
    ),
    true,
  );
  assert.equal(
    (
      await db("organizations")
        .where({ id: registration.user.organization_id })
        .first()
    ).status,
    "under_review",
  );
  passed(
    "Registration, real SMTP OTP, incorrect-code handling, cooldown and verification",
  );
  await page.goto(`${base}/app/settings`);
  await page
    .getByRole("button", { name: "Password & security", exact: true })
    .click();
  await page
    .getByLabel("Password to change sign-in verification", { exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Enable sign-in codes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable sign-in codes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${base}/login`);
  // Establish the intended destination after logout has completed. Login must
  // restore this protected route, not race the previous Settings navigation.
  await page.goto(`${base}/app`);
  await expect(page).toHaveURL(`${base}/login`);
  await page
    .getByLabel("Work email", { exact: true })
    .fill("partner@qa.example");
  await page.getByLabel("Password", { exact: true }).fill(password);
  offset = received.length;
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in to PartnerHub" }).click();
  const signIn = await (await signInResponse).json();
  assert.equal(signIn.requiresOtp, true);
  assert.equal(signIn.verificationCode, undefined);
  assert.equal(signIn.user, undefined);
  assert.equal(
    (await context.request.get(`${base}/api/dashboard`)).status(),
    401,
  );
  const signInMail = await mailSince(offset, "sign-in code is");
  await accessibility("Sign-in verification");
  await page.screenshot({
    path: path.join(artifacts, "sign-in-verification.png"),
  });
  await page
    .getByLabel("Sign-in code", { exact: true })
    .fill(signInMail.body.match(/sign-in code is (\d{6})/)[1]);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(`${base}/app`);
  passed(
    "Password plus SMTP sign-in code creates a session only after verification",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${base}/login`);
  await page.goto(`${base}/forgot-password`);
  await page
    .getByLabel("Work email", { exact: true })
    .fill("partner@qa.example");
  offset = received.length;
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(page.locator(".success-panel")).toContainText(
    "reset email has been requested",
  );
  const resetMail = await mailSince(offset, "reset-password?token=");
  const resetToken = resetMail.body.match(
    /reset-password\?token=([a-f0-9]{64})/,
  )[1];
  await page.goto(`${base}/reset-password?token=${resetToken}`);
  await page.getByLabel("New password", { exact: true }).fill(replacement);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await expect(page.locator(".form-error")).toContainText("do not match");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(replacement);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await expect(page.locator(".success-panel")).toContainText(
    "password is updated",
  );
  await page.goto(`${base}/reset-password?token=${resetToken}`);
  await expect(page.locator(".auth-link-error")).toContainText(
    "expired or has already been used",
  );
  passed(
    "SMTP password recovery validates confirmation and rejects reused links",
  );
  await page.goto(`${base}/login`);
  await page
    .getByLabel("Work email", { exact: true })
    .fill("partner@qa.example");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to PartnerHub" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "email or password is incorrect",
  );
  await page.getByLabel("Password", { exact: true }).fill(replacement);
  offset = received.length;
  await page.getByRole("button", { name: "Sign in to PartnerHub" }).click();
  const finalMail = await mailSince(offset, "sign-in code is");
  await page
    .getByLabel("Sign-in code", { exact: true })
    .fill(finalMail.body.match(/sign-in code is (\d{6})/)[1]);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(`${base}/app`);
  await page.goto(`${base}/app/settings`);
  await page
    .getByRole("button", { name: "Password & security", exact: true })
    .click();
  await expect(page.locator(".account-sessions")).toContainText("This device");
  await accessibility("Account security");
  passed(
    "Old password rejected, new password and SMTP MFA accepted, active session visible",
  );
  assert.equal(
    Number((await db("users").count({ count: "*" }).first()).count),
    2,
  );
  assert.equal(
    Number((await db("records").count({ count: "*" }).first()).count),
    0,
  );
  passed(
    "Only browser-created accounts exist; no seeded companies or transactions",
  );
} catch (error) {
  checks.push({
    name: "Acceptance failure",
    passed: false,
    error: String(error),
  });
  await page
    ?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (db) await (await import("../server/events.ts")).deliverEmails();
  if (app) await new Promise((resolve) => app.close(resolve));
  await new Promise((resolve) => smtp.close(resolve));
  await db?.destroy();
  await writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        demoMode: false,
        provider: "Authenticated SMTP on loopback",
        checks,
        messagesReceived: received.length,
        smtpAuthentications: authenticationCount,
      },
      null,
      2,
    ),
  );
  await rm(temporary, { recursive: true, force: true });
}
