import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { emptyIdentity, identityLabels } from "../shared/ai";
import { demoAccounts, demoPassword } from "../shared/demo";
import { legacyCapabilityReply } from "../tests/fixtures/ai-reply";

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
    confirm_password: demoPassword,
  })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  const phone = page.getByLabel("Phone number", { exact: true });
  await phone.fill("-------");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(phone).toBeVisible();
  expect(
    await phone.evaluate((input: HTMLInputElement) => input.validationMessage),
  ).toContain("7–15 digits");
  await phone.fill("+91 9000000000");
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
  await page
    .getByRole("button", { name: "Company overview", exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator(".notice-banner")).toContainText(
    "Identity and company documents reviewed.",
  );
  await inspectAccessibility(page);
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
    await teammate.locator('input[name="password"]').fill(demoPassword);
    await teammate.locator('input[name="confirm_password"]').fill(demoPassword);
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
    await expect(teammate).toHaveURL(/\/app\/settings$/);
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
    "ai",
    "approvals",
    "integrations",
    "master-data",
    "resources",
    "insights",
    "inquiries",
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

test("public workflow tabs support keyboards and the header stays fixed while scrolling", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator(".public-header");
  await expect(header).toBeVisible();
  const before = await header.boundingBox();
  await page.evaluate(() => window.scrollTo(0, 1700));
  const after = await header.boundingBox();
  expect(after!.y).toBe(before!.y);
  const tabs = page.getByRole("tablist", { name: "Organization workspaces" });
  const supplier = tabs.getByRole("tab", { name: "Supplier", exact: true });
  await supplier.click();
  await supplier.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "Client / Buyer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/partners", "/contact"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await inspectAccessibility(page);
    }
  }
});

test("CSV import, authorized contacts and resource pools work through their forms", async ({
  page,
}) => {
  await login(page, "supplier");
  await page.goto("/app/catalog");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await modal(page)
    .getByLabel("CSV file", { exact: true })
    .setInputFiles({
      name: "qa-catalog.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "title,sku,price,moq\nBrowser imported network switch,BROWSER-SKU-BULK,1200,2",
      ),
    });
  await modal(page).getByRole("button", { name: "Validate CSV" }).click();
  await expect(modal(page)).toContainText("Ready to import");
  await modal(page).getByRole("button", { name: "Import 1 records" }).click();
  await expect(modal(page)).toContainText("1 records imported");
  await modal(page)
    .getByRole("link", { name: /Browser imported network switch/ })
    .click();
  await expect(page.locator("main h1")).toContainText(
    "Browser imported network switch",
  );
  await login(page, "vendor");
  await page.goto("/app/profile");
  await page
    .getByRole("button", { name: "Authorized contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await modal(page)
    .getByLabel("Full name", { exact: true })
    .fill("Browser Finance Contact");
  await modal(page)
    .getByLabel("Business role", { exact: true })
    .fill("Finance");
  await modal(page)
    .getByLabel("Work email", { exact: true })
    .fill("browser.finance@example.test");
  await modal(page).getByRole("button", { name: "Save contact" }).click();
  await expect(page.locator(".contact-grid")).toContainText(
    "Browser Finance Contact",
  );
  await page.goto("/app/resources");
  await page.getByRole("button", { name: "Add resource pool" }).click();
  for (const [name, value] of Object.entries({
    title: "Browser cloud engineers",
    skills: "Cloud, TypeScript",
    location: "Pune",
    experience: "4",
    count: "3",
    available_from: future(3),
    rate: "800",
  }))
    await field(page, name).fill(value);
  await modal(page).getByRole("button", { name: "Save availability" }).click();
  await expect(modal(page)).toBeHidden();
  await expect(page.locator("tbody")).toContainText("Browser cloud engineers");
});

test("shared definitions populate forms and public enquiries reach the support workspace", async ({
  page,
}) => {
  await page.goto("/contact");
  for (const [name, value] of Object.entries({
    name: "Browser Enquirer",
    email: "browser.enquirer@example.test",
    company: "Browser Enterprise",
    message:
      "We would like assistance with partner onboarding and procurement.",
  }))
    await page.locator(`form [name="${name}"]`).fill(value);
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.locator(".success-panel")).toContainText("INQ-");
  await login(page, "support");
  await page.goto("/app/inquiries");
  await page
    .getByRole("row")
    .filter({ hasText: "Browser Enterprise" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await modal(page)
    .getByLabel("Status", { exact: true })
    .selectOption("resolved");
  await modal(page)
    .getByLabel("Internal resolution notes")
    .fill("Partner onboarding guidance prepared for the business.");
  await modal(page).getByRole("button", { name: "Save follow-up" }).click();
  await expect(modal(page)).toBeHidden();
  await expect(
    page.getByRole("row").filter({ hasText: "Browser Enterprise" }),
  ).toContainText("Resolved");
  await login(page, "admin");
  await page.goto("/app/master-data");
  await page
    .getByRole("button", { name: "Units of measure", exact: true })
    .click();
  await page.getByRole("button", { name: "Add value", exact: true }).click();
  await modal(page)
    .getByLabel("Value", { exact: true })
    .fill("QA licensed seats");
  await modal(page).getByRole("button", { name: "Save configuration" }).click();
  await expect(modal(page)).toBeHidden();
  await create(page, "rfqs");
  await expect(
    modal(page).locator(
      '#record-master-units option[value="QA licensed seats"]',
    ),
  ).toHaveCount(1);
});

test("mobile navigation supports the complete menu, keyboard dismissal and scoped workspace routes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(modal(page)).toBeVisible();
  await expect(
    modal(page).getByRole("link", { name: "Register your organization" }),
  ).toBeVisible();
  await expect(
    modal(page).getByRole("navigation", { name: "Explore PartnerHub" }),
  ).toBeVisible();
  await inspectAccessibility(page);
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open menu", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await modal(page).locator(".hub-drawer-workspaces summary").click();
  await modal(page)
    .getByRole("link", { name: "Recruitment Company", exact: true })
    .click();
  await expect(page).toHaveURL(/\/register\?type=recruitment$/);
  await login(page, "vendor");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Main navigation" }),
  ).toBeVisible();
  expect(
    await page.locator(".app-main").evaluate((element) => element.inert),
  ).toBe(true);
  await expect(
    modal(page).getByRole("link", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await inspectAccessibility(page);
  await modal(page).getByRole("link", { name: "RFQs", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/rfqs$/);
  await expect(
    page.getByRole("dialog", { name: "Main navigation" }),
  ).toHaveCount(0);
  expect(
    await page.locator(".app-main").evaluate((element) => element.inert),
  ).toBe(false);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  for (const route of ["/app/rfqs", "/app/rfqs?status=open"]) {
    await page.goto(route);
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await modal(page).getByRole("link", { name: "RFQs", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/rfqs$/);
    await expect(
      page.getByRole("dialog", { name: "Main navigation" }),
    ).toHaveCount(0);
    expect(
      await page.locator(".app-main").evaluate((element) => element.inert),
    ).toBe(false);
  }
});

test("signing out clears the workspace in other open tabs", async ({
  page,
  context,
}) => {
  await login(page, "vendor");
  const second = await context.newPage();
  try {
    await second.goto("/app/settings");
    await expect(second.locator("main h1")).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(second).toHaveURL(/\/login$/);
    await expect(second.locator(".sidebar")).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test("VS AI shows branded typing, supports Stop and Retry, reveals replies and respects reduced motion", async ({
  page,
}) => {
  await login(page, "buyer");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        connected: true,
        capabilities: {
          draft: true,
          comparison: true,
          discovery: true,
          documents: true,
          alerts: true,
        },
      },
    }),
  );
  let attempts = 0,
    release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const responseText =
    "This browser acceptance response verifies how a completed answer appears. Your authorized RFQs, invoices and documents remain available through their workspace modules. Review the linked record before making a business decision.";
  await page.route("**/api/ai/chat", async (route) => {
    attempts++;
    if (attempts === 1) {
      await pending;
      await route.abort().catch(() => {});
      return;
    }
    if (attempts === 2) {
      await route.fulfill({
        status: 503,
        json: {
          error: "VS AI is temporarily at capacity. Please try again later.",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        conversationId: "qa-browser-conversation",
        messages: [
          {
            id: "qa-user",
            role: "user",
            content: "Show me pending RFQs.",
            sources: [],
            structured: {},
          },
          {
            id: `qa-answer-${attempts}`,
            role: "assistant",
            content: responseText,
            sources: [],
            structured: {},
          },
        ],
      },
    });
  });
  await page.goto("/app/ai");
  await expect(
    page.getByRole("heading", { name: "VS AI Assistant", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ai-welcome .vs-ai-monogram")).toBeVisible();
  await page
    .getByLabel("Ask VS AI", { exact: true })
    .fill("Show me pending RFQs.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await expect(page.locator(".ai-typing-dots i")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".ai-typing-dots i")
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("vs-ai-dot");
    expect(
      await page
        .locator(".ai-thinking .vs-ai-halo")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("vs-ai-orbit");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.getByText(
        "Request stopped. Your text is ready when you want to try again.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Ask VS AI", { exact: true })).toHaveValue(
      "Show me pending RFQs.",
    );
  } finally {
    release();
  }
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("VS AI is temporarily at capacity. Please try again later."),
  ).toBeVisible();
  await expect(page.locator(".ai-thinking")).toHaveCount(0);
  await expect(page.getByLabel("Ask VS AI", { exact: true })).toHaveValue(
    "Show me pending RFQs.",
  );
  await page
    .getByRole("button", { name: "Retry request", exact: true })
    .click();
  await expect(
    page.locator('.ai-message-assistant .ai-markdown[data-revealing="true"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show full reply", exact: true })
    .click();
  await expect(page.locator(".ai-message-assistant .ai-markdown")).toHaveText(
    responseText,
  );
  await expect(page.locator("main")).not.toContainText(
    /Gemini|requests today|Powered by/,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByLabel("Ask VS AI", { exact: true })
    .fill("Show me pending RFQs.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".ai-message-assistant .ai-markdown")).toHaveText(
    responseText,
  );
  await expect(page.locator('.ai-markdown[data-revealing="true"]')).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await inspectAccessibility(page);
});

test("VS AI replaces raw routes with accessible named actions in new and saved replies", async ({
  page,
}) => {
  await login(page, "buyer");
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        connected: true,
        capabilities: {
          draft: true,
          comparison: true,
          discovery: true,
          documents: true,
          alerts: true,
        },
      },
    }),
  );
  const conversation = {
    conversationId: "qa-legacy-routes",
    messages: [
      {
        id: "qa-legacy-reply",
        role: "assistant",
        content: legacyCapabilityReply,
        sources: [{ id: "module:ai", title: "VS AI", href: "/app/ai" }],
        structured: { citedSourceIds: ["module:ai"] },
      },
    ],
  };
  await page.route("**/api/ai/conversations", (route) =>
    route.fulfill({
      json: [
        {
          id: conversation.conversationId,
          title: "QA saved capability reply",
          updated_at: new Date().toISOString(),
        },
      ],
    }),
  );
  await page.route("**/api/ai/conversations/qa-legacy-routes", (route) =>
    route.fulfill({ json: conversation }),
  );
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({ json: conversation }),
  );
  await page.goto("/app/ai");
  await page.getByLabel("Ask VS AI", { exact: true }).fill("What can you do?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.locator(".ai-message-assistant");
  await expect(answer.locator(".ai-actions a")).toHaveCount(6);
  await expect(answer).not.toContainText(/\/app|mode=|Gemini|requests today/);
  await expect(answer.locator(".ai-sources")).toHaveCount(0);
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-actions-desktop.png",
    fullPage: true,
  });
  await answer
    .getByRole("link", { name: "Extract a document", exact: true })
    .click();
  await expect(page.locator(".document-workflow")).toBeVisible();
  await page
    .getByRole("button", { name: /^QA saved capability reply/ })
    .click();
  await expect(answer.locator(".ai-actions a")).toHaveCount(6);
  await expect(answer).not.toContainText(/\/app|mode=/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-actions-mobile.png",
    fullPage: true,
  });
  await answer
    .getByRole("link", { name: "Draft a requirement", exact: true })
    .click();
  await expect(page.locator(".ai-task-grid > button.active")).toContainText(
    "Draft a requirement",
  );
});

test("document AI animates real progress events, preserves review decisions and carries document context into chat", async ({
  page,
}) => {
  await login(page, "vendor");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: { connected: true, capabilities: { documents: true } },
    }),
  );
  const gates = Array.from({ length: 3 }, () => {
    let release!: () => void;
    return {
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
      release: () => release(),
    };
  });
  let documentId = "";
  // Only the provider progress is controlled here. Upload, storage and document
  // authorization use the disposable application's real endpoints. Backend and
  // live-provider suites separately verify extraction content and decisions.
  const stream = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5183");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,X-CSRF-Token,Accept",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    documentId = JSON.parse(Buffer.concat(chunks).toString()).documentId;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    const event = (kind: string, data: any) =>
      res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
    event("progress", { stage: "uploaded" });
    for (const [i, stage] of [
      "reading",
      "extracting",
      "validating",
    ].entries()) {
      event("progress", {
        stage,
        ...(stage === "reading" ? { pagesRead: 1, totalPages: 1 } : {}),
      });
      await gates[i].promise;
    }
    event("progress", { stage: "ready" });
    event("result", {
      id: "qa-progress-extraction",
      documentId,
      documentName: "qa-browser-document.pdf",
      documentStatus: "uploaded",
      reviewStatus: "pending_human_review",
      result: {
        documentType: "QA browser document",
        summary: "The uploaded acceptance document is ready for human review.",
        text: "QA reference BROWSER-417",
        identity: emptyIdentity(),
        fields: [{ name: "Reference", value: "BROWSER-417", confidence: 0.9 }],
        warnings: [],
        validation: Object.keys(identityLabels).map((field) => ({
          field,
          status: "missing",
          message: "Not present in this acceptance source.",
        })),
      },
    });
    res.end();
  });
  await new Promise<void>((resolve) => stream.listen(0, "127.0.0.1", resolve));
  const streamUrl = `http://127.0.0.1:${(stream.address() as any).port}/events`;
  await page.route("**/api/ai/extract-document", (route) =>
    route.continue({ url: streamUrl }),
  );
  const questions: any[] = [];
  await page.route("**/api/ai/chat", (route) => {
    const body = route.request().postDataJSON();
    questions.push(body);
    return route.fulfill({
      json: {
        conversationId: "qa-document-context",
        messages: [
          {
            id: `qa-document-answer-${questions.length}`,
            role: "assistant",
            content:
              "The uploaded document contains reference BROWSER-417. It is awaiting human review.",
            sources: [],
            structured: {
              documentContext: body.documentId
                ? { id: body.documentId, name: "qa-browser-document.pdf" }
                : undefined,
            },
          },
        ],
      },
    });
  });
  try {
    await page.goto("/app/ai?mode=document");
    const workflow = page.getByRole("region", {
      name: "Document processing workflow",
    });
    await expect(workflow).toBeVisible();
    await expect(workflow.locator("ol > li")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Upload & extract", exact: true })
      .click();
    await modal(page)
      .getByLabel("Choose document file")
      .setInputFiles({
        name: "invalid.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Unsupported test file"),
      });
    await expect(
      modal(page).getByText("Choose a PDF, PNG or JPEG document.", {
        exact: true,
      }),
    ).toBeVisible();
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("QA reference BROWSER-417", { x: 40, y: 750 });
    const pdfBytes = Buffer.from(await pdf.save());
    await modal(page).getByLabel("Choose document file").setInputFiles({
      name: "qa-browser-document.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    await modal(page)
      .getByRole("button", { name: "Upload & extract", exact: true })
      .click();
    await expect(modal(page)).toBeHidden();
    await expect(workflow).toHaveAttribute("data-stage", "reading");
    await expect(
      workflow.getByRole("progressbar", { name: "PDF pages read" }),
    ).toHaveAttribute("value", "1");
    await expect(workflow.locator(".is-complete")).toHaveCount(1);
    expect(
      await workflow
        .locator(".is-current .document-workflow-orbit")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("document-orbit");
    gates[0].release();
    await expect(workflow).toHaveAttribute("data-stage", "extracting");
    await page.screenshot({
      path: "artifacts/local-verification/document-ai-processing-desktop.png",
      fullPage: true,
    });
    gates[1].release();
    await expect(workflow).toHaveAttribute("data-stage", "validating");
    await expect(workflow.locator(".is-complete")).toHaveCount(2);
    gates[2].release();
    await expect(workflow).toHaveAttribute("data-stage", "ready");
    await expect(workflow.locator(".is-complete")).toHaveCount(3);
    await expect(workflow.locator('[aria-current="step"] strong')).toHaveText(
      "Human review",
    );
    await expect(workflow.locator("li").last()).not.toHaveClass(/is-complete/);
    await expect(page.locator(".document-workflow")).toHaveCount(1);
    await expect(page.locator(".ai-extraction")).toContainText("BROWSER-417");
    const nextSteps = page.getByRole("region", {
      name: "Next steps for this document",
    });
    await expect(
      nextSteps.getByRole("heading", { name: "Awaiting VS verification" }),
    ).toBeVisible();
    await expect(
      nextSteps.getByRole("link", { name: "View review status" }),
    ).toHaveAttribute("href", `/app/documents?document=${documentId}`);
    await expect(
      nextSteps.getByRole("link", { name: "Download original document" }),
    ).toHaveAttribute("href", `/api/documents/${documentId}/download`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      nextSteps
        .getByRole("link", { name: "Download original document" })
        .click(),
    ]);
    expect(
      Buffer.compare(await readFile((await download.path())!), pdfBytes),
    ).toBe(0);
    await expect(
      page.getByRole("button", { name: "Extract document", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>(".toast button")?.click();
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "artifacts/local-verification/document-ai-review-desktop.png",
      fullPage: true,
    });
    await nextSteps.screenshot({
      path: "artifacts/local-verification/document-ai-next-steps.png",
    });
    await inspectAccessibility(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      (await workflow.getByRole("heading", { level: 2 }).boundingBox())!.width,
    ).toBeGreaterThan(170);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await workflow
        .locator(".is-current .document-workflow-orbit")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "artifacts/local-verification/document-ai-review-mobile.png",
      fullPage: true,
    });
    await inspectAccessibility(page);
    await page
      .getByRole("button", {
        name: "Ask VS AI about this document",
        exact: true,
      })
      .click();
    await expect(page.locator(".ai-document-context")).toContainText(
      "qa-browser-document.pdf",
    );
    await page
      .getByLabel("Ask VS AI", { exact: true })
      .fill("Can you explain the reference on this file?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".ai-message-assistant")).toContainText(
      "BROWSER-417",
    );
    expect(questions.at(-1).documentId).toBe(documentId);
    await page.getByRole("button", { name: "Remove document context" }).click();
    await page
      .getByLabel("Ask VS AI", { exact: true })
      .fill("How do I find my RFQs?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => questions.length).toBe(2);
    expect(questions.at(-1).documentId).toBeNull();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page, "verification");
    await page.goto(`/app/ai?mode=document&document=${documentId}`);
    await page
      .getByRole("button", { name: "Extract document", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ready for your review", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/local-verification/document-ai-verifier.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: "Start document review" }).click();
    await expect(modal(page)).toBeVisible();
    await modal(page)
      .getByLabel("Review notes")
      .fill("Browser QA reviewer checked the original uploaded PDF.");
    await modal(page).getByRole("button", { name: "Save decision" }).click();
    await expect(modal(page)).toBeHidden();
    await login(page, "vendor");
    await page.goto(`/app/ai?mode=document&document=${documentId}`);
    await page
      .getByRole("button", { name: "Extract document", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Document approved", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Document processing workflow" })
        .locator(".is-complete"),
    ).toHaveCount(5);
    await expect(
      page.getByRole("link", { name: "View review details" }),
    ).toBeVisible();
  } finally {
    for (const gate of gates) gate.release();
    stream.closeAllConnections();
    await new Promise<void>((resolve) => stream.close(() => resolve()));
  }
});

test("VS AI task results support editable drafts, commercial comparison, partner discovery and operational follow-up", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "buyer");
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        connected: true,
        capabilities: {
          draft: true,
          comparison: true,
          discovery: true,
          documents: true,
          alerts: true,
        },
      },
    }),
  );
  // Controlled language results test presentation. The draft save, record links
  // and partner navigation use the real isolated application and permissions.
  const answer = (structured: any, content: string, sources: any[] = []) => ({
    conversationId: "qa-tools",
    messages: [
      {
        id: `qa-tools-${Date.now()}`,
        role: "assistant",
        content,
        sources,
        structured,
      },
    ],
  });
  const draft = {
    title: "QA office equipment requirement",
    payload: {
      requirement_type: "procurement",
      description: "Ten laptops for the Pune office with on-site delivery.",
      category: "IT Hardware",
      location: "Pune",
      required_date: future(30),
      deadline: future(10),
      budget: 0,
      quantity: 10,
      delivery_requirements: "Deliver to the Pune office",
      technology: "Windows",
      criteria: "Approved suppliers",
    },
    items: [
      {
        name: "Business laptop",
        specification: "16 GB memory",
        quantity: 10,
        unit: "units",
        unit_price: 0,
        tax: 18,
        discount: 0,
      },
    ],
  };
  await page.route("**/api/ai/draft-requirement", (route) =>
    route.fulfill({
      json: answer(
        { draft, warnings: ["Confirm your budget before publishing."] },
        "The brief is ready to review. Confirm the budget and required delivery date before saving.",
      ),
    }),
  );
  await page.goto("/app/ai?mode=draft");
  await page
    .getByLabel("Ask VS AI", { exact: true })
    .fill(
      "We need 10 Windows laptops in Pune with 16 GB memory and office delivery.",
    );
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Review requirement" }).click();
  await expect(field(page, "quantity")).toHaveValue("10");
  await field(page, "title").fill("QA reviewed equipment requirement");
  await field(page, "budget").fill("600000");
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-requirement-review.png",
    fullPage: true,
  });
  const saved = await save(page);
  expect(saved.status).toBe("draft");
  expect(saved.title).toBe("QA reviewed equipment requirement");
  expect(saved.payload.budget).toBe(600000);

  const quoteRecords = (
    await (await page.request.get("/api/records/quotations?limit=2")).json()
  ).items;
  expect(quoteRecords.length).toBeGreaterThan(0);
  const quotes = quoteRecords.map((record: any) => ({
    id: record.id,
    number: record.number,
    partner: "QA comparison partner",
    currency: record.currency,
    total_minor: record.amount_minor,
    subtotal_minor: record.amount_minor,
    tax_minor: 0,
    discount_minor: 0,
    delivery_charges_minor: 0,
    delivery_date: future(20),
    warranty: "One year",
    payment_terms: "Net 30",
    validity: future(15),
    missingInformation: [],
  }));
  let comparisonRequest: any;
  await page.route("**/api/ai/analyze-quotations", (route) => {
    comparisonRequest = route.request().postDataJSON();
    return route.fulfill({
      json: answer(
        { comparison: quotes },
        "Review the recorded commercial terms below. The buyer makes the selection.",
      ),
    });
  });
  await page.goto("/app/ai?mode=comparison");
  await page.getByLabel("RFQ to analyze").selectOption({ index: 1 });
  const rfqId = await page.getByLabel("RFQ to analyze").inputValue();
  await page
    .getByRole("button", { name: "Analyze quotations", exact: true })
    .last()
    .click();
  await expect(page.locator(".ai-commercial-evidence")).toContainText(
    "Payment terms",
  );
  await expect(page.locator(".ai-commercial-evidence")).toContainText("Net 30");
  expect(comparisonRequest.rfqId).toBe(rfqId);
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-commercial-comparison.png",
    fullPage: true,
  });
  await page
    .locator(".ai-commercial-evidence")
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/quotations/${quotes[0].id}$`));
  await expect(page.locator("main h1")).toBeVisible();

  const partnerId = seedId("org:vendor"),
    partnerSource = {
      id: partnerId,
      title: "View matching partner",
      href: `/app/organizations/${partnerId}`,
    };
  let discoveryRequest: any;
  await page.route("**/api/ai/discover", (route) => {
    discoveryRequest = route.request().postDataJSON();
    return route.fulfill({
      json: answer(
        {
          discovery: {
            considered: 1,
            total: 1,
            criteria: { technology: "React", verification: "active" },
            truncated: false,
          },
          citedSourceIds: [partnerId],
        },
        "One partner matches these criteria. Open its profile to review its capabilities.",
        [partnerSource],
      ),
    });
  });
  await page.goto("/app/ai?mode=discovery");
  await page
    .getByText("Refine by partner profile fields", { exact: true })
    .click();
  await page.getByLabel("Partner Technology", { exact: true }).fill("React");
  await page
    .getByLabel("Ask VS AI", { exact: true })
    .fill("Find an approved technology partner with React capabilities.");
  await page
    .getByRole("button", { name: "Find partners", exact: true })
    .last()
    .click();
  await expect(page.locator(".ai-search-evidence")).toContainText(
    "1 matching partner",
  );
  await expect(page.locator(".ai-search-evidence")).not.toContainText(
    "database",
  );
  expect(discoveryRequest.criteria.technology).toBe("React");
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-partner-discovery.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "View matching partner" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/organizations/${partnerId}$`));
  await expect(page.locator("main h1")).toBeVisible();

  await page.route("**/api/ai/analyze-alerts", (route) =>
    route.fulfill({
      json: answer(
        {
          alertSummary: {
            totalAlerts: 2,
            asOf: new Date().toISOString(),
            limited: false,
          },
        },
        "Two commitments need review. Open the operational evidence to inspect their dates and recorded status.",
      ),
    }),
  );
  await page.goto("/app/ai?mode=alerts");
  await page
    .getByRole("button", { name: "Review alerts", exact: true })
    .click();
  await expect(page.locator(".ai-message-assistant")).toContainText(
    "2 operational signals",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await inspectAccessibility(page);
  await page.screenshot({
    path: "artifacts/local-verification/ai-operational-alerts-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".ai-message-assistant")
    .getByRole("link", { name: "View current evidence" })
    .click();
  await expect(page).toHaveURL(/\/app\/insights$/);
  await expect(page.locator("main h1")).toBeVisible();
});
