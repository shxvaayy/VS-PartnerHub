import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { parse } from "csv-parse/sync";
import { readFile } from "node:fs/promises";

async function login(page: Page) {
  await page.goto("/login?demo=true");
  await page
    .getByRole("button", { name: "Explore Super Admin workspace" })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("main h1")).toBeVisible();
}

test("record search follows browser history without a stale query replacing the restored filters", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/rfqs");
  const search = page.locator(".table-filters .search-input input");
  await search.fill("cloud");
  await expect(page).toHaveURL(/q=cloud/);
  await page
    .getByRole("combobox", { name: "Filter by status" })
    .selectOption("published");
  await expect(page).toHaveURL(/status=published/);
  await search.fill("managed");
  await expect(page).toHaveURL(/q=managed/);
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(search).toHaveValue("cloud");
  await expect(
    page.getByRole("combobox", { name: "Filter by status" }),
  ).toHaveValue("");
  await expect(page).toHaveURL(/\/app\/rfqs\?q=cloud$/);
  await page.goForward();
  await page.waitForLoadState("networkidle");
  await expect(search).toHaveValue("managed");
  await expect(
    page.getByRole("combobox", { name: "Filter by status" }),
  ).toHaveValue("published");
  await page.reload();
  await expect(search).toHaveValue("managed");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(
    page.getByRole("combobox", { name: "Filter by status" }),
  ).toHaveValue("published");
});

test("directory filters survive profile navigation and reload, and the downloaded CSV contains the same organizations", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const all = await (
    await page.request.get("/api/organizations?limit=100")
  ).json();
  const target = all.items[0];
  expect(target.city).toBeTruthy();
  await page.goto("/app/organizations");
  const location = page.getByRole("textbox", { name: "Location filter" });
  await location.fill(target.city);
  await expect(
    page.getByRole("button", { name: "Remove location filter" }),
  ).toBeVisible();
  const expected = await (
    await page.request.get(
      `/api/organizations?limit=100&location=${encodeURIComponent(target.city)}`,
    )
  ).json();
  await expect(page.locator(".directory-results")).toContainText(
    new RegExp(`^${expected.total} organization`),
  );
  const listUrl = new URL(page.url());
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export directory" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const exported = parse(await readFile((await download.path())!, "utf8"), {
    columns: true,
    bom: true,
  });
  expect(exported.map((row: any) => row.Reference).sort()).toEqual(
    expected.items.map((row: any) => row.number).sort(),
  );
  await page
    .locator(`main a[href="/app/organizations/${target.id}"]`)
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/organizations/${target.id}$`));
  await expect(page.locator("main h1")).toHaveText(target.legal_name);
  await expect(page.locator(".back-link")).toHaveText("Partner directory");
  await expect(page.locator(".back-link")).toHaveAttribute(
    "href",
    listUrl.pathname + listUrl.search,
  );
  await page.locator(".back-link").click();
  await expect(location).toHaveValue(target.city);
  await page
    .locator(`main a[href="/app/organizations/${target.id}"]`)
    .first()
    .click();
  await expect(page.locator("main h1")).toHaveText(target.legal_name);
  await page.goBack();
  await expect(location).toHaveValue(target.city);
  await page.reload();
  await expect(location).toHaveValue(target.city);
  await expect(
    page.getByRole("button", { name: "Remove location filter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Directory grid view" }).click();
  await page.reload();
  await expect(page.locator(".organization-grid")).toBeVisible();
  await expect(location).toHaveValue(target.city);
  const gridUrl = page.url();
  await page
    .locator(".organization-card")
    .filter({
      has: page.getByRole("heading", { name: target.legal_name, exact: true }),
    })
    .getByRole("link", { name: "View profile" })
    .click();
  await page.reload();
  await page.locator(".back-link").click();
  await expect(page).toHaveURL(gridUrl);
  await expect(page.locator(".organization-grid")).toBeVisible();
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(location).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&]location=/);
  await expect(page).toHaveURL(/view=grid/);
});

test("record Back links restore filtered lists and the recruitment pipeline after detail reloads", async ({
  page,
}) => {
  await login(page);
  for (const kind of ["rfqs", "candidates"]) {
    const { items } = await (
      await page.request.get(`/api/records/${kind}?limit=1`)
    ).json();
    const target = items[0];
    expect(target).toBeTruthy();
    const filters = new URLSearchParams({
      q: target.title,
      status: target.status,
    });
    if (kind === "candidates") filters.set("view", "board");
    const returnTo = `/app/${kind}?${filters}`;
    await page.goto(returnTo);
    await page
      .locator(`main a[href="/app/${kind}/${target.id}"]`)
      .first()
      .click();
    await expect(page.locator("main h1")).toHaveText(target.title);
    await page.reload();
    await expect(page.locator(".back-link")).toHaveAttribute("href", returnTo);
    await page.locator(".back-link").click();
    await expect(page).toHaveURL(new URL(returnTo, page.url()).href);
    await expect(
      page.locator(".table-filters .search-input input"),
    ).toHaveValue(target.title);
    await expect(
      page.getByRole("combobox", { name: "Filter by status" }),
    ).toHaveValue(target.status);
    if (kind === "candidates") {
      await expect(page.locator(".kanban-board")).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Pipeline board view" }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "List view", exact: true })
        .click();
      await expect(page.locator(".main-record-table")).toBeVisible();
      await expect(page).not.toHaveURL(/[?&]view=/);
    }
  }
});

test("partner profiles return to the originating discovery or verification workspace", async ({
  page,
}) => {
  await login(page);
  const { items } = await (
    await page.request.get("/api/organizations?status=active&limit=1")
  ).json();
  const target = items[0];
  for (const [workspace, title] of [
    ["discovery", "Discover partners"],
    ["verification", "Verification center"],
  ]) {
    const returnTo = `/app/${workspace}?${new URLSearchParams({ status: "active", q: target.legal_name })}`;
    await page.goto(returnTo);
    await page
      .locator(`main a[href="/app/organizations/${target.id}"]`)
      .first()
      .click();
    await expect(page.locator(".back-link")).toHaveText(title);
    await expect(page.locator(".back-link")).toHaveAttribute("href", returnTo);
    await page.locator(".back-link").click();
    await expect(page).toHaveURL(new URL(returnTo, page.url()).href);
    await expect(page.locator(".directory-results")).toContainText(
      "1 organization",
    );
  }
});

test("capability filters are shareable, can be removed individually, and remain usable on narrow screens", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 320, height: 700 });
  const capability = "No matching capability for this isolated browser check";
  await page.goto(
    `/app/discovery?capability=${encodeURIComponent(capability)}&location=India`,
  );
  await expect(
    page.getByRole("button", { name: "Remove capabilities filter" }),
  ).toBeVisible();
  await page.locator(".discovery-advanced > summary").click();
  await expect(page.getByLabel("Capabilities", { exact: true })).toHaveValue(
    capability,
  );
  await expect(
    page.getByRole("heading", { name: "Your next connection is out there" }),
  ).toBeVisible();
  const filters = page.getByRole("group", { name: "Active directory filters" });
  for (const chip of await filters.getByRole("button").all()) {
    const box = await chip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("discovery-filters-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Remove capabilities filter" })
    .click();
  await expect(page.getByLabel("Capabilities", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("textbox", { name: "Location filter" }),
  ).toHaveValue("India");
  await expect(page).not.toHaveURL(/[?&]capability=/);
  await expect(page.locator(".organization-grid")).toBeVisible();
});

for (const kind of ["quotations", "organizations"] as const) {
  test(`${kind}: action menus fit phone, landscape and desktop screens, support keyboards, and keep decisions uncommitted until confirmation`, async ({
    page,
  }) => {
    await login(page);
    const path =
      kind === "organizations"
        ? "/api/organizations?status=active&limit=1"
        : "/api/records/quotations?limit=100";
    const list = await (await page.request.get(path)).json();
    let target: any;
    for (const item of list.items) {
      const detail = await (
        await page.request.get(
          kind === "organizations"
            ? `/api/organizations/${item.id}`
            : `/api/records/quotations/${item.id}`,
        )
      ).json();
      if (kind === "organizations" || detail.allowed_transitions?.length) {
        target = detail;
        break;
      }
    }
    expect(target).toBeTruthy();
    await page.goto(`/app/${kind}/${target.id}`);
    const trigger = page.locator(".action-menu > summary");
    const menu = page.locator(".action-menu-panel");
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 600, height: 375 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      if (kind === "quotations" && viewport.width === 320) {
        for (const region of [
          page.getByRole("region", { name: "Quotation workflow stages" }),
          page.getByRole("region", { name: "Line items", exact: true }),
        ]) {
          await region.focus();
          await page.keyboard.press("ArrowRight");
          await expect
            .poll(() => region.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
          await page.keyboard.press("End");
          await expect
            .poll(() =>
              region.evaluate((element) =>
                Math.abs(
                  element.scrollWidth -
                    element.clientWidth -
                    element.scrollLeft,
                ),
              ),
            )
            .toBeLessThanOrEqual(1);
          await page.keyboard.press("Home");
          await expect
            .poll(() => region.evaluate((element) => element.scrollLeft))
            .toBe(0);
        }
      }
      await trigger.click();
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(10);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        viewport.width - 10,
      );
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
        viewport.height - 10,
      );
      for (const action of await menu.getByRole("button").all()) {
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport({ ratio: 1 });
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      if (viewport.width === 320) {
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          accessibility.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`${kind}-actions-mobile.png`),
        });
      }
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await trigger.press("ArrowDown");
    await expect(menu.getByRole("button").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("button").last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("button").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.locator("main h1").click();
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await menu.getByRole("button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(trigger).toBeFocused();
    const after = await (
      await page.request.get(
        kind === "organizations"
          ? `/api/organizations/${target.id}`
          : `/api/records/quotations/${target.id}`,
      )
    ).json();
    expect(after.status).toBe(target.status);
    if (kind === "quotations") expect(after.version).toBe(target.version);
  });
}
