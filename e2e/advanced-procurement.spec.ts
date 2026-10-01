import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

const evidence = "artifacts/advanced-procurement";
const future = (days = 0) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const seedId = (key: string) => {
  const h = createHash("sha256").update(`vs-partnerhub:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const modal = (page: Page) => page.getByRole("dialog");
async function login(page: Page, key: string) {
  await page.goto("/login?demo=true");
  await page.getByLabel("Demo workspace role").selectOption(key);
  await page.getByRole("button", { name: /^Explore .* workspace$/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("main h1")).toBeVisible();
}
async function request(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
) {
  const session = await (await page.request.get("/api/auth/session")).json();
  const response = await page.request.fetch("/api" + path, {
    method,
    headers: { "X-CSRF-Token": session.csrfToken },
    data,
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}
const recordInput = (title: string, payload: any, extra: any = {}) => ({
  title,
  payload,
  currency: "INR",
  items: [],
  invitations: [],
  ...extra,
});
async function change(page: Page, record: any, status: string) {
  const current = await request(
    page,
    "GET",
    `/records/${record.kind}/${record.id}`,
  );
  return request(
    page,
    "POST",
    `/records/${record.kind}/${record.id}/transition`,
    {
      status,
      version: current.version,
      note: "Reviewed during isolated browser verification.",
    },
  );
}
async function save(page: Page, kind: string, method = "POST") {
  const pending = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/records/${kind}`) &&
      r.request().method() === method,
  );
  await modal(page).locator('button[type="submit"]').click();
  const response = await pending,
    body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(modal(page)).toBeHidden();
  return body;
}
async function openDecision(page: Page, status: string) {
  await page.locator(".action-menu summary").click();
  await page
    .locator(".action-menu")
    .getByRole("button", {
      name: new RegExp(`^${status.replaceAll("_", " ")}$`, "i"),
    })
    .click();
  await modal(page)
    .getByLabel("Decision note")
    .fill("Reviewed with the supporting business evidence.");
}
async function confirmDecision(page: Page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/transition") && r.request().method() === "POST",
  );
  await modal(page).getByRole("button", { name: "Confirm update" }).click();
  const response = await pending,
    body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(modal(page)).toBeHidden();
  return body;
}
async function checkAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        failureSummary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function noHorizontalOverflow(page: Page) {
  const measurement = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      extending: [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > width + 1)
        .slice(0, 25)
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
          overflow: getComputedStyle(element).overflowX,
        })),
    };
  });
  expect(
    measurement.overflow,
    JSON.stringify(measurement.extending),
  ).toBeLessThanOrEqual(1);
}
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});

test("Partner 360 has scoped drill-downs and a usable mobile layout", async ({
  page,
}) => {
  await login(page, "buyer");
  const vendor = seedId("org:vendor");
  await page.goto(`/app/organizations/${vendor}`);
  await page.getByRole("link", { name: "Partner 360°" }).click();
  await expect(
    page.getByRole("heading", { name: "Partner 360°", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your shared business activity", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Document details are available to the organization and its authorized verification team.",
    ),
  ).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/partner-360-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "View agreed po value" }).click();
  await expect(page).toHaveURL(new RegExp(`organization_id=${vendor}`));
  await expect(
    page.getByText("Showing this organization's authorized records"),
  ).toBeVisible();
  await page.goto(`/app/organizations/${vendor}/360`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", {
      name: "Connected business activity",
      exact: true,
    }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({
    path: `${evidence}/partner-360-mobile.png`,
    fullPage: true,
  });
  await checkAccessibility(page);
});

test("an RFP proposal can be created, assessed and compared through the UI", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "buyer");
  const vendor = await request(
    page,
    "GET",
    `/organizations/${seedId("org:vendor")}`,
  );
  await page.goto("/app/rfqs?new=true");
  await modal(page)
    .locator('[name="title"]')
    .fill("Enterprise infrastructure RFP browser acceptance");
  await modal(page).getByLabel("Request type").selectOption("RFP");
  await modal(page)
    .getByLabel("Scope of work & deliverables")
    .fill(
      "Implement an enterprise infrastructure solution with delivery, migration and acceptance evidence.",
    );
  await modal(page)
    .getByLabel("Evaluation criteria", { exact: true })
    .fill(
      "Assess technical fit and implementation readiness alongside pricing and commercial terms.",
    );
  await modal(page).getByLabel("Technical evaluation weight (%)").fill("70");
  await modal(page)
    .getByLabel("Delivery address", { exact: true })
    .fill("Bengaluru technology campus");
  await modal(page)
    .getByRole("checkbox", { name: new RegExp(vendor.legal_name) })
    .check();
  await modal(page)
    .getByLabel("Item 1 name", { exact: true })
    .fill("Infrastructure deployment");
  const rfp = await save(page, "rfqs");
  expect(rfp.number).toMatch(/^RFP-/);
  await openDecision(page, "published");
  await confirmDecision(page);
  await login(page, "vendor");
  await page.goto(`/app/quotations?new=true&parent=${rfp.id}`);
  await modal(page)
    .getByLabel("Technical proposal", { exact: true })
    .fill(
      "A resilient cloud and network architecture aligned with the enterprise requirements.",
    );
  await modal(page)
    .getByLabel("Implementation plan", { exact: true })
    .fill(
      "Discovery, migration, validation and buyer acceptance over four delivery phases.",
    );
  await modal(page)
    .getByLabel("Compliance response", { exact: true })
    .fill("All mandatory requirements are covered with supporting evidence.");
  await modal(page)
    .getByLabel("Item 1 unit price", { exact: true })
    .fill("10000");
  const proposal = await save(page, "quotations");
  await openDecision(page, "submitted");
  await confirmDecision(page);
  await login(page, "buyer");
  await page.goto(`/app/quotations/${proposal.id}`);
  await page
    .getByRole("button", { name: "Proposal evaluation", exact: true })
    .click();
  await page.getByLabel("Technical score · 70% weight").fill("80");
  await page.getByLabel("Commercial score · 30% weight").fill("60");
  await page
    .getByLabel("Assessment & supporting rationale")
    .fill(
      "The solution meets the technical scope; commercial terms have been assessed against the published criteria.",
    );
  await page.getByRole("button", { name: "Save evaluation" }).click();
  await expect(
    page.getByText("Current assessment", { exact: true }),
  ).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/rfp-evaluation.png`,
    fullPage: true,
  });
  await page.goto(`/app/rfqs/${rfp.id}/compare`);
  await expect(
    page.getByRole("rowheader", { name: "Technical proposal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("74.0 / 100 · Current", { exact: true }),
  ).toBeVisible();
  await checkAccessibility(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/rfp-comparison-mobile.png`,
    fullPage: true,
  });
});

test("buyer receipt evidence and actual invoice prices drive the three-way matching UI", async ({
  page,
}) => {
  test.setTimeout(90000);
  const items = [
    {
      name: "Evidence workstation",
      quantity: 2,
      unit: "units",
      unit_price: 1000,
      tax: 0,
      discount: 0,
    },
  ];
  await login(page, "buyer");
  let rfq = await request(
    page,
    "POST",
    "/records/rfqs",
    recordInput(
      "Browser receiving requirement",
      {
        deadline: future(10),
        required_date: future(30),
        delivery_address: "Buyer receiving facility",
      },
      { invitations: [seedId("org:vendor")], items },
    ),
  );
  rfq = await change(page, rfq, "published");
  await login(page, "vendor");
  let quotation = await request(
    page,
    "POST",
    "/records/quotations",
    recordInput(
      "Browser receiving quotation",
      {
        delivery_date: future(20),
        validity: future(30),
        payment_terms: "Net 30",
      },
      { parent_id: rfq.id, items },
    ),
  );
  quotation = await change(page, quotation, "submitted");
  await login(page, "buyer");
  quotation = await change(page, quotation, "approved");
  let order = await request(
    page,
    "POST",
    "/records/orders",
    recordInput(
      "Browser matching PO",
      {
        delivery_date: future(20),
        delivery_address: "Receiving facility",
        payment_terms: "Net 30",
      },
      { parent_id: quotation.id },
    ),
  );
  for (const status of ["pending_approval", "approved", "sent"])
    order = await change(page, order, status);
  await login(page, "vendor");
  order = await change(page, order, "acknowledged");
  let delivery = await request(
    page,
    "POST",
    "/records/deliveries",
    recordInput(
      "Browser evidence delivery",
      {
        carrier: "Acceptance logistics",
        tracking_number: randomUUID(),
        expected_date: future(7),
      },
      { parent_id: order.id },
    ),
  );
  for (const status of ["dispatched", "in_transit", "delivered"])
    delivery = await change(page, delivery, status);
  await login(page, "buyer");
  await page.goto(`/app/deliveries/${delivery.id}`);
  await openDecision(page, "confirmed");
  await modal(page)
    .getByLabel("Receipt / acceptance reference")
    .fill("UI-RECEIPT-1001");
  await modal(page)
    .getByLabel("Accept Evidence workstation", { exact: true })
    .fill("2");
  await checkAccessibility(page);
  await confirmDecision(page);
  await page
    .getByRole("button", { name: "Receipts & acceptance", exact: true })
    .click();
  await expect(page.getByText("Fully received", { exact: true })).toBeVisible();
  await login(page, "vendor");
  await page.goto(`/app/invoices?new=true&parent=${order.id}`);
  await modal(page)
    .locator('[name="invoice_number"]')
    .fill("UI-ACTUAL-INVOICE-1001");
  await modal(page)
    .getByLabel("Item 1 unit price", { exact: true })
    .fill("1100");
  let invoice = await save(page, "invoices");
  expect(invoice.amount_minor).toBe(220000);
  await openDecision(page, "submitted");
  invoice = await confirmDecision(page);
  await login(page, "buyer");
  await page.goto(`/app/invoices/${invoice.id}`);
  await page
    .getByRole("button", { name: "Three-way match", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Invoice exceptions need review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Unit price differs from PO", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/invoice-exceptions.png`,
    fullPage: true,
  });
  await openDecision(page, "approved");
  await modal(page).getByRole("button", { name: "Confirm update" }).click();
  await expect(
    modal(page).getByText(/Three-way matching has unresolved exceptions/),
  ).toBeVisible();
  await modal(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  invoice = await change(page, invoice, "rejected");
  await login(page, "vendor");
  await page.goto(`/app/invoices/${invoice.id}`);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await modal(page)
    .getByLabel("Item 1 unit price", { exact: true })
    .fill("1000");
  invoice = await save(page, "invoices", "PATCH");
  await openDecision(page, "draft");
  invoice = await confirmDecision(page);
  await openDecision(page, "submitted");
  invoice = await confirmDecision(page);
  await login(page, "buyer");
  await page.goto(`/app/invoices/${invoice.id}`);
  await page
    .getByRole("button", { name: "Three-way match", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Three-way match complete" }),
  ).toBeVisible();
  await openDecision(page, "approved");
  await confirmDecision(page);
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/invoice-three-way-match.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
});

test("bank workbench imports, matches, reverses and classifies evidence through the UI", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "buyer");
  const payment = await request(
    page,
    "GET",
    `/records/payments/${seedId("record:payment:chairs")}`,
  );
  await page.goto("/app/reconciliation");
  await page
    .getByRole("button", { name: "Add bank account", exact: true })
    .click();
  await modal(page).getByLabel("Account label").fill("Browser finance account");
  await modal(page)
    .getByLabel("Bank name", { exact: true })
    .fill("Acceptance bank");
  await modal(page).getByLabel("Account last four digits").fill("1234");
  await modal(page)
    .getByRole("button", { name: "Add bank account", exact: true })
    .click();
  await expect(modal(page)).toBeHidden();
  await page
    .getByRole("button", { name: "Import statement", exact: true })
    .click();
  await modal(page)
    .getByLabel("Statement CSV")
    .setInputFiles({
      name: "browser-statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `date,transaction_id,reference,description,debit,credit,currency\n${future()},UI-BANK-001,${payment.payload.transaction_id},Payment evidence,300,,INR\n${future()},UI-BANK-FEE,MONTHLY-FEE,Bank service charge,10,,INR\n`,
      ),
    });
  await expect(
    modal(page).getByText("Validation passed", { exact: true }),
  ).toBeVisible();
  await modal(page)
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(modal(page)).toBeHidden();
  const paymentRow = page
    .getByRole("row")
    .filter({ hasText: payment.payload.transaction_id });
  await paymentRow.getByRole("button", { name: "Review", exact: true }).click();
  await modal(page)
    .getByLabel(`Select ${payment.number}`, { exact: true })
    .check();
  await modal(page)
    .getByLabel("Matching evidence / note")
    .fill("Verified the bank reference and recorded payment evidence.");
  await modal(page)
    .getByRole("button", { name: "Confirm match", exact: true })
    .click();
  await expect(
    modal(page).getByRole("heading", {
      name: "This bank debit is fully reconciled",
    }),
  ).toBeVisible();
  await modal(page)
    .getByRole("button", { name: /Matches & history/ })
    .click();
  await expect(
    modal(page).getByText("Active match", { exact: true }),
  ).toBeVisible();
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/bank-match-history.png`,
    fullPage: true,
  });
  await modal(page)
    .getByRole("button", { name: "Reverse match", exact: true })
    .click();
  await modal(page)
    .getByLabel("Reason for reversing this match")
    .fill("Correcting this entry after checking the bank reference.");
  await modal(page)
    .getByRole("button", { name: "Confirm reversal", exact: true })
    .click();
  await expect(
    modal(page).getByText("Reversed", { exact: true }),
  ).toBeVisible();
  await modal(page)
    .getByRole("button", { name: "Close review", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "MONTHLY-FEE" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "Classify exception", exact: true })
    .click();
  await modal(page).getByLabel("Exception category").selectOption("bank_fee");
  await modal(page)
    .getByLabel("Classification reason")
    .fill("Confirmed monthly bank account service charge.");
  await modal(page)
    .getByRole("button", { name: "Save classification", exact: true })
    .click();
  await expect(
    modal(page).getByText("Classified exception", { exact: true }),
  ).toBeVisible();
  await modal(page)
    .getByRole("button", { name: "Close review", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "MONTHLY-FEE" }),
  ).toContainText("Classified exception");
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/bank-reconciliation-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await checkAccessibility(page);
  await page.screenshot({
    path: `${evidence}/bank-reconciliation-mobile.png`,
    fullPage: true,
  });
});
