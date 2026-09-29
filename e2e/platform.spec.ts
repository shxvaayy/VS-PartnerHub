import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { demoAccounts, demoPassword } from "../shared/demo";

const future = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const seedId = (key: string) => {
  const h = createHash("sha256").update(`vs-partnerhub:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const modal = (page: Page) => page.getByRole("dialog");
const field = (page: Page, name: string) =>
  modal(page).locator(`[name="${name}"]`);
async function login(page: Page, key: string) {
  await page.goto("/login?demo=true");
  await page.getByLabel("Demo workspace role").selectOption(key);
  await page.getByRole("button", { name: /^Explore .* workspace$/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("main h1")).toBeVisible();
}
async function create(page: Page, kind: string, parent?: string) {
  await page.goto(`/app/${kind}?new=true${parent ? `&parent=${parent}` : ""}`);
  await expect(modal(page).locator('[name="title"]')).toBeVisible();
  if (parent) await expect(field(page, "parent_id")).toHaveValue(parent);
}
async function save(page: Page, method = "POST") {
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/records/") && r.request().method() === method,
  );
  await modal(page).locator('button[type="submit"]').click();
  const result = await response;
  const body = await result.json();
  expect(result.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(modal(page)).toBeHidden();
  return body;
}
async function transition(page: Page, status: string) {
  const label = status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  await page.locator(".action-menu summary").click();
  await page
    .locator(".action-menu")
    .getByRole("button", { name: label, exact: true })
    .click();
  await modal(page)
    .getByLabel("Decision note")
    .fill("Reviewed during browser acceptance verification.");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/transition") && r.request().method() === "POST",
  );
  await modal(page).getByRole("button", { name: "Confirm update" }).click();
  const result = await response;
  const body = await result.json();
  expect(result.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(modal(page)).toBeHidden();
  await expect(page.locator(".page-actions > .badge")).toHaveText(
    new RegExp(label, "i"),
  );
  return body;
}
async function edit(page: Page, values: Record<string, string>) {
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  for (const [name, value] of Object.entries(values)) {
    const input = field(page, name);
    if (await input.evaluate((e) => e.tagName === "SELECT"))
      await input.selectOption(value);
    else await input.fill(value);
  }
  await field(page, "note").fill("Acceptance verification update.");
  return save(page, "PATCH");
}
async function inspectAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        reason: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("recruitment onboarding, document review and VS approval work through the browser", async ({
  page,
}) => {
  await page.goto("/register?type=recruitment");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, value] of Object.entries({
    name: "Browser Partner",
    email: "browser.onboarding@example.test",
    contact_phone: "+91 9000000000",
    password: demoPassword,
  })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, value] of Object.entries({
    legal_name: "Browser Recruitment Company",
    city: "Bengaluru",
    address: "1 Technology Park, Bengaluru",
  })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Recruitment domains")).toBeVisible();
  await expect(page.locator('[name="products"]')).toHaveCount(0);
  for (const [name, value] of Object.entries({
    description: "Recruitment for enterprise technology teams.",
    locations: "Bengaluru",
    capabilities: "IT recruitment",
    domains: "IT",
    experience: "8",
    recruiters: "Browser Recruiter",
  })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  await page.getByLabel("Permanent Hiring", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Upload PAN", { exact: true })
    .setInputFiles("e2e/fixtures/company.pdf");
  await page
    .getByLabel("Upload Incorporation", { exact: true })
    .setInputFiles("e2e/fixtures/company.pdf");
  await page.locator('[name="accept_terms"]').check();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/auth/register") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create your partner account" })
    .click();
  const registration = await (await response).json();
  await expect(page).toHaveURL(/\/verify$/);
  const code = await page.locator(".dev-code code").innerText();
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await login(page, "verification");
  await page.goto(`/app/organizations/${registration.user.organization_id}`);
  await page.getByRole("button", { name: "Documents & KYC" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await page
      .locator("tbody tr")
      .nth(index)
      .getByRole("button", { name: "Review", exact: true })
      .click();
    await modal(page)
      .getByLabel("Review notes")
      .fill("Inspected the sample company document.");
    await modal(page).getByRole("button", { name: "Save decision" }).click();
    await expect(modal(page)).toBeHidden();
    await expect(
      page.locator("tbody tr").nth(index).locator(".badge"),
    ).toHaveText(/Approved/);
  }
  await page.locator(".action-menu summary").click();
  await page
    .getByRole("button", { name: "Approve organization", exact: true })
    .click();
  await modal(page)
    .getByLabel("Verification notes")
    .fill("Identity and company documents reviewed.");
  await modal(page).locator('button[type="submit"]').click();
  await expect(modal(page)).toBeHidden();
  await expect(page.locator(".company-title .badge")).toHaveText(/Active/);
});

test("buyer and vendor complete requirement to delivery, invoice and payment", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page, "buyer");
  await create(page, "requirements");
  await field(page, "title").fill("Browser monitor procurement");
  await field(page, "category").selectOption("Information Technology");
  await modal(page)
    .getByLabel("Item 1 name", { exact: true })
    .fill("27 inch enterprise monitor");
  await modal(page).getByLabel("Item 1 quantity", { exact: true }).fill("2");
  const requirement = await save(page);
  await transition(page, "open");
  await create(page, "rfqs", requirement.id);
  await field(page, "delivery_address").fill("Acme Campus, Bengaluru");
  await modal(page)
    .getByRole("checkbox", { name: /Nexora/ })
    .check();
  const rfq = await save(page);
  await transition(page, "published");
  await login(page, "vendor");
  await page.goto(`/app/rfqs/${rfq.id}`);
  await page.getByRole("link", { name: "Submit a quotation" }).click();
  await expect(
    modal(page).getByLabel("Item 1 name", { exact: true }),
  ).toHaveValue("27 inch enterprise monitor");
  await modal(page)
    .getByLabel("Item 1 unit price", { exact: true })
    .fill("1000");
  const quote = await save(page);
  expect(quote.amount_minor).toBe(236000);
  await transition(page, "submitted");
  await login(page, "buyer");
  await page.goto(`/app/rfqs/${rfq.id}/compare`);
  await expect(page.locator(".comparison-table")).toContainText(/Nexora/);
  await page.goto(`/app/quotations/${quote.id}`);
  await transition(page, "approved");
  await page.getByRole("link", { name: "Create purchase order" }).click();
  await field(page, "delivery_address").fill("Acme Campus, Bengaluru");
  const order = await save(page);
  expect(order.amount_minor).toBe(236000);
  await transition(page, "pending_approval");
  await transition(page, "approved");
  await transition(page, "sent");
  await login(page, "vendor");
  await page.goto(`/app/orders/${order.id}`);
  await transition(page, "acknowledged");
  await page.getByRole("link", { name: "Add delivery" }).click();
  await field(page, "carrier").fill("Browser Logistics");
  await field(page, "tracking_number").fill("BROWSER-DEL-001");
  const delivery = await save(page);
  await transition(page, "dispatched");
  await transition(page, "in_transit");
  await transition(page, "delivered");
  await login(page, "buyer");
  await page.goto(`/app/deliveries/${delivery.id}`);
  await transition(page, "confirmed");
  await page.goto(`/app/orders/${order.id}`);
  await expect(page.locator(".page-actions > .badge")).toHaveText(/Fulfilled/);
  await login(page, "vendor");
  await page.goto(`/app/orders/${order.id}`);
  await page.getByRole("link", { name: "Create invoice" }).click();
  await field(page, "invoice_number").fill("BROWSER-INV-001");
  const invoice = await save(page);
  expect(invoice.amount_minor).toBe(236000);
  await transition(page, "submitted");
  await login(page, "finance");
  await page.goto(`/app/invoices/${invoice.id}`);
  await transition(page, "under_review");
  await transition(page, "approved");
  await page.getByRole("link", { name: "Record payment" }).click();
  await field(page, "amount").fill("2360");
  await field(page, "reference").fill("Browser payment reference");
  await field(page, "transaction_id").fill("BROWSER-TX-001");
  await save(page);
  await transition(page, "completed");
  await page.goto(`/app/invoices/${invoice.id}`);
  await expect(page.locator(".page-actions > .badge")).toHaveText(/Paid/);
  await page.getByRole("button", { name: /History/ }).click();
  await expect(page.locator(".record-history")).toContainText(/Paid|paid/);
});

test("recruiter and HR complete candidate submission, interview, offer, BGV and joining", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "recruiter");
  await create(page, "candidates", seedId("record:hiring:fullstack"));
  for (const [name, value] of Object.entries({
    title: "Browser Candidate",
    email: "browser.candidate@example.test",
    phone: "+91 9000000001",
    skills: "React, TypeScript",
    notice_period: "30 days",
    experience: "6",
  }))
    await field(page, name).fill(value);
  await field(page, "consent").check();
  const candidate = await save(page);
  await login(page, "hr");
  await page.goto(`/app/candidates/${candidate.id}`);
  await transition(page, "screening");
  await transition(page, "shortlisted");
  await page.getByRole("link", { name: "Schedule interview" }).click();
  await field(page, "title").fill("Browser technical interview");
  await field(page, "scheduled_at").fill(`${future(1)}T10:30`);
  await field(page, "interviewer").fill("Ananya Rao");
  const interview = await save(page);
  await page.goto(`/app/candidates/${candidate.id}`);
  await transition(page, "interview");
  await page.goto(`/app/interviews/${interview.id}`);
  await edit(page, {
    feedback: "Strong technical and collaboration skills.",
    recommendation: "Proceed",
  });
  await transition(page, "completed");
  await page.goto(`/app/candidates/${candidate.id}`);
  await transition(page, "selected");
  await edit(page, { offer_date: future(0), offer_compensation: "2400000" });
  await transition(page, "offer");
  await transition(page, "bgv");
  await edit(page, { bgv_status: "Clear" });
  await transition(page, "onboarding");
  await edit(page, { joining_date: future(0) });
  await transition(page, "joined");
});

test("team invitation creates a scoped account and email sign-in verification can be enabled", async ({
  page,
  browser,
}) => {
  await login(page, "vendor");
  await page.goto("/app/team");
  await page.getByRole("button", { name: "Invite a teammate" }).click();
  await modal(page).getByLabel("Full name").fill("Browser Teammate");
  await modal(page)
    .getByLabel("Work email")
    .fill("browser.teammate@example.test");
  await modal(page).getByRole("button", { name: "Create invitation" }).click();
  const url = await modal(page)
    .getByLabel("Local invitation link")
    .inputValue();
  const invited = await browser.newContext();
  const teammate = await invited.newPage();
  try {
    await teammate.goto(url);
    await teammate.getByLabel("Your name").fill("Browser Teammate");
    await teammate.locator('input[type="password"]').fill(demoPassword);
    await teammate.locator('button[type="submit"]').click();
    await expect(teammate).toHaveURL(/\/app$/);
    await teammate.goto("http://127.0.0.1:5183/app/settings");
    await teammate.getByRole("button", { name: "Password & security" }).click();
    await teammate
      .getByLabel("Password to change sign-in verification")
      .fill(demoPassword);
    await teammate
      .getByRole("button", { name: "Enable sign-in codes" })
      .click();
    await expect(
      teammate.getByRole("button", { name: "Disable sign-in codes" }),
    ).toBeVisible();
    await teammate
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await teammate
      .getByLabel("Work email")
      .fill("browser.teammate@example.test");
    await teammate.locator('input[name="password"]').fill(demoPassword);
    await teammate.locator('button[type="submit"]').click();
    await expect(
      teammate.getByRole("heading", { name: "A quick security check." }),
    ).toBeVisible();
    const code = await teammate.locator(".dev-code code").innerText();
    await teammate.getByLabel("Sign-in code").fill(code);
    await teammate.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(teammate).toHaveURL(/\/app$/);
  } finally {
    await invited.close();
  }
});

test("service, staffing and technology partners complete their dedicated workflows", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "service");
  await create(page, "milestones", seedId("record:contract:services"));
  await field(page, "title").fill("Browser service milestone");
  await field(page, "amount").fill("10000");
  await field(page, "deliverable").fill(
    "A documented process review and implementation report.",
  );
  const milestone = await save(page);
  await transition(page, "in_progress");
  await edit(page, {
    completion_notes: "Report delivered and reviewed with the client.",
  });
  await transition(page, "submitted");
  await login(page, "buyer");
  await page.goto(`/app/milestones/${milestone.id}`);
  await transition(page, "approved");
  await create(
    page,
    "demos",
    seedId("record:catalog:CloudCraft One · Cloud management"),
  );
  await field(page, "use_case").fill(
    "Centralized cloud cost and access management.",
  );
  const demo = await save(page);
  await login(page, "technology");
  await page.goto(`/app/demos/${demo.id}`);
  await edit(page, {
    scheduled_at: `${future(2)}T14:30`,
    meeting_link: "https://example.com/partner-demo",
  });
  await transition(page, "scheduled");
  await transition(page, "completed");
  await login(page, "staffing");
  await create(page, "timesheets", seedId("record:engagement:1"));
  await field(page, "title").fill("Browser staffing timesheet");
  await field(page, "period_start").fill(future(1));
  await field(page, "period_end").fill(future(7));
  await field(page, "hours").fill("40");
  await field(page, "work_summary").fill(
    "Completed the agreed weekly delivery tasks.",
  );
  const timesheet = await save(page);
  await transition(page, "submitted");
  await login(page, "buyer");
  await page.goto(`/app/timesheets/${timesheet.id}`);
  await transition(page, "approved");
});

test("contract renewals, performance reviews and support conversations are actionable", async ({
  page,
}) => {
  await login(page, "buyer");
  const contract = seedId("record:contract:services");
  await page.goto(`/app/contracts/${contract}`);
  await page
    .getByRole("button", { name: "Renew contract", exact: true })
    .click();
  await modal(page).getByLabel("New end date").fill(future(500));
  await modal(page)
    .getByLabel("Amendment / renewal notes")
    .fill("Extend the services agreement following the commercial review.");
  await modal(page).getByRole("button", { name: "Request renewal" }).click();
  await expect(modal(page)).toBeHidden();
  await transition(page, "approved");
  await transition(page, "active");
  await create(page, "performance", contract);
  await field(page, "title").fill("Browser quarterly service review");
  await field(page, "feedback").fill(
    "Reliable delivery and clear communication throughout the engagement.",
  );
  await save(page);
  await transition(page, "published");
  await login(page, "vendor");
  await create(page, "tickets");
  await field(page, "title").fill("Browser support request");
  await field(page, "description").fill(
    "Please help confirm our company profile information.",
  );
  const ticket = await save(page);
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page
    .getByLabel("Your message")
    .fill("Our contact information was updated today.");
  await page.getByRole("button", { name: /Send message/ }).click();
  await expect(page.locator(".conversation-list")).toContainText(
    "Our contact information was updated today.",
  );
  await login(page, "support");
  await page.goto(`/app/tickets/${ticket.id}`);
  await transition(page, "in_progress");
  await edit(page, {
    resolution: "Company contact details have been checked and confirmed.",
  });
  await transition(page, "resolved");
});

test("all demo personas and main workspace routes load without browser errors", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const account of demoAccounts) {
    await login(page, account.key);
    await expect(page.locator("main")).not.toContainText(
      /We couldn’t load this page|Let’s reconnect/,
    );
  }
  await login(page, "admin");
  for (const route of [
    "organizations",
    "verification",
    "discovery",
    "requirements",
    "rfqs",
    "quotations",
    "orders",
    "deliveries",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "candidates",
    "interviews",
    "engagements",
    "timesheets",
    "milestones",
    "demos",
    "performance",
    "documents",
    "team",
    "roles",
    "reports",
    "audit",
    "settings",
    "notifications",
    "tickets",
  ]) {
    await page.goto(`/app/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(
      /We couldn’t load this page|Let’s reconnect|Your role cannot access/,
    );
  }
  expect(errors).toEqual([]);
});

test("search, keyboard dialog access, charts and mobile layouts remain usable", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(page.locator(".recharts-area-area").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole("textbox").fill("Nexora");
  await expect(modal(page)).toContainText("Nexora");
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();
  await page.goto("/app/rfqs");
  const trigger = page.getByRole("button", { name: /New rfq/i });
  await trigger.click();
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector("dialog")?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/app",
      "/app/discovery",
      "/app/rfqs",
      "/app/settings",
    ]) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      const size = await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(size.content, `${route} at ${width}px`).toBeLessThanOrEqual(
        size.viewport,
      );
    }
  }
});

test("public pages, dashboard and record forms pass WCAG A/AA automated checks", async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const route of ["/", "/login", "/register"]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await inspectAccessibility(page);
  }
  await login(page, "admin");
  await expect(page.locator(".recharts-area-area").first()).toBeVisible();
  await inspectAccessibility(page);
  await create(page, "rfqs");
  await inspectAccessibility(page);
});
