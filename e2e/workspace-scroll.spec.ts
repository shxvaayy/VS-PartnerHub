import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const names = [
  "Vendor",
  "Supplier",
  "Client / Buyer",
  "Recruitment Company",
  "Staffing Company",
  "Service Provider",
  "Technology Partner",
  "Business Partner",
  "Other",
];
const tabs = (page: Page) =>
  page.getByRole("tablist", { name: "Organization workspaces" });
async function tour(page: Page) {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
    "data-scroll",
    "true",
  );
  return page.locator(".hub-workspace-track").evaluate((track) => {
    const stage = track.querySelector<HTMLElement>(".hub-workspace-stage")!;
    const top = Number.parseFloat(getComputedStyle(stage).top);
    return {
      start: window.scrollY + track.getBoundingClientRect().top - top,
      distance: track.clientHeight - stage.offsetHeight,
      top,
    };
  });
}
async function move(page: Page, top: number) {
  await page.evaluate(
    (top) => window.scrollTo({ top, behavior: "instant" }),
    top,
  );
}

test.describe("Public workspace scroll tour", () => {
  test.use({ reducedMotion: "no-preference" });

  test("pins the card, visits all nine workspaces in both directions and releases after the last", async ({
    page,
  }) => {
    const geometry = await tour(page);
    for (const i of [...names.keys(), ...[...names.keys()].reverse()]) {
      await move(
        page,
        geometry.start + ((i + 0.35) / names.length) * geometry.distance,
      );
      await expect(
        tabs(page).getByRole("tab", { name: names[i], exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("tabpanel", { name: names[i], exact: true }),
      ).toBeVisible();
      expect(
        await page
          .locator(".hub-workspace-stage")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBeCloseTo(geometry.top, 0);
      expect(
        await page
          .locator(".public-header")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBe(0);
    }
    await move(page, geometry.start + geometry.distance + 190);
    await expect(
      tabs(page).getByRole("tab", { name: "Other", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await page
        .locator(".hub-workspace-stage")
        .evaluate((el) => el.getBoundingClientRect().top),
    ).toBeLessThan(geometry.top - 170);
    await page.locator("#lifecycle").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("tablist", { name: "Procurement lifecycle" }),
    ).toBeInViewport();
  });

  test("direct tabs, keyboard selection and skip navigation stay synchronized with scrolling", async ({
    page,
  }) => {
    const geometry = await tour(page);
    await move(page, geometry.start + geometry.distance / 36);
    const technology = tabs(page).getByRole("tab", {
      name: "Technology Partner",
      exact: true,
    });
    await technology.click();
    await expect(technology).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(geometry.start + (geometry.distance * 6) / 9);
    await expect(
      page
        .getByRole("tabpanel", { name: "Technology Partner", exact: true })
        .getByRole("link"),
    ).toHaveAttribute("href", "/register?type=technology_partner");
    await technology.press("End");
    const other = tabs(page).getByRole("tab", { name: "Other", exact: true });
    await expect(other).toBeFocused();
    await expect(other).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(geometry.start + (geometry.distance * 8) / 9);
    await other.press("Home");
    await expect(
      tabs(page).getByRole("tab", { name: "Vendor", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(geometry.start + geometry.distance / 9);
    await page
      .getByRole("link", { name: "Explore the full workflow", exact: true })
      .click();
    await expect(
      page.locator("#lifecycle .hub-section-heading"),
    ).toBeInViewport();
  });

  test("phone scrolling keeps the selected tab and complete card visible, and short viewports retain usable tabs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const geometry = await tour(page);
    await move(page, geometry.start + (geometry.distance * 6.35) / 9);
    const technology = tabs(page).getByRole("tab", {
      name: "Technology Partner",
      exact: true,
    });
    await expect(technology).toHaveAttribute("aria-selected", "true");
    await expect(technology).toBeInViewport({ ratio: 0.95 });
    const box = await page.locator(".hub-workspace-stage").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
      "data-scroll",
      "false",
    );
    await tabs(page)
      .getByRole("tab", { name: "Recruitment Company", exact: true })
      .click();
    const recruitment = page.getByRole("tabpanel", {
      name: "Recruitment Company",
      exact: true,
    });
    await expect(recruitment).toBeVisible();
    await recruitment.getByRole("link").scrollIntoViewIfNeeded();
    await expect(recruitment.getByRole("link")).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
  });
});

test("reduced-motion users can choose every workspace without a pinned scroll tour", async ({
  page,
}) => {
  await page.goto("/");
  await tabs(page).scrollIntoViewIfNeeded();
  await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
    "data-scroll",
    "false",
  );
  for (const name of names) {
    await tabs(page).getByRole("tab", { name, exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name, exact: true }),
    ).toBeVisible();
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});
