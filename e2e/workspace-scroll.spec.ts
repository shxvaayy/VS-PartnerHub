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
    const spacing = await page
      .locator(".hub-workspace-stage")
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        const header = document
          .querySelector(".public-header")!
          .getBoundingClientRect();
        return {
          above: box.top - header.bottom,
          below: window.innerHeight - box.bottom,
          insideBottom:
            box.bottom -
            el
              .querySelector(".hub-workspace-scroll-footer")!
              .getBoundingClientRect().bottom,
        };
      });
    expect(Math.abs(spacing.above - spacing.below)).toBeLessThan(2);
    expect(spacing.insideBottom).toBeLessThan(28);
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
});

test.describe("Mobile workspace scroll tour", () => {
  test.use({ isMobile: true, hasTouch: true, reducedMotion: "no-preference" });

  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [360, 640],
    [320, 568],
    [375, 550],
  ]) {
    test(`${width} × ${height}: all workspaces fit, scroll forward and backward, then release`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const geometry = await tour(page);
      for (const i of [...names.keys(), 6, 3, 0]) {
        await move(
          page,
          geometry.start + ((i + 0.35) / names.length) * geometry.distance,
        );
        const selected = tabs(page).getByRole("tab", {
          name: names[i],
          exact: true,
        });
        await expect(selected).toHaveAttribute("aria-selected", "true");
        await expect(selected).toBeInViewport({ ratio: 0.95 });
        const panel = page.getByRole("tabpanel", {
          name: names[i],
          exact: true,
        });
        await expect(panel.getByRole("link")).toBeInViewport({ ratio: 1 });
        const box = await page.locator(".hub-workspace-stage").boundingBox();
        expect(box!.y).toBeCloseTo(geometry.top, 0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height - 10);
        expect(
          await panel.locator(".hub-workspace-journey > div").count(),
        ).toBe(4);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      }
      await move(page, geometry.start + geometry.distance + 160);
      await expect(
        tabs(page).getByRole("tab", { name: "Other", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        await page
          .locator(".hub-workspace-stage")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBeLessThan(geometry.top - 140);
      await page
        .getByRole("link", { name: "Explore the full workflow", exact: true })
        .click();
      await expect(
        page.locator("#lifecycle .hub-section-heading"),
      ).toBeInViewport();
    });
  }

  test("native touch swipes advance and reverse; tapping a tab synchronizes the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const geometry = await tour(page);
    const step = geometry.distance / names.length;
    await move(page, geometry.start + step * 0.25);
    const session = await page.context().newCDPSession(page);
    for (const [distance, name] of [
      [-step * 1.1, "Supplier"],
      [step * 1.1, "Vendor"],
    ] as const) {
      await session.send("Input.synthesizeScrollGesture", {
        x: 185,
        y: 460,
        xDistance: 0,
        yDistance: Math.round(distance),
        speed: 420,
        gestureSourceType: "touch",
        preventFling: true,
      });
      await expect(
        tabs(page).getByRole("tab", { name, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
    }
    await session.detach();
    const buyer = tabs(page).getByRole("tab", {
      name: "Client / Buyer",
      exact: true,
    });
    await buyer.tap();
    await expect(buyer).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(geometry.start + 2 * step);
    await expect(
      page
        .getByRole("tabpanel", { name: "Client / Buyer", exact: true })
        .getByRole("link"),
    ).toHaveAttribute("href", "/register?type=client");
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

  test("resizing and rotating keeps the selected workspace without clipping or trapping the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const geometry = await tour(page);
    await move(
      page,
      geometry.start + (geometry.distance * 6.35) / names.length,
    );
    const technology = tabs(page).getByRole("tab", {
      name: "Technology Partner",
      exact: true,
    });
    await expect(technology).toHaveAttribute("aria-selected", "true");
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 375, height: 550 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
        "data-scroll",
        "true",
      );
      await expect(technology).toHaveAttribute("aria-selected", "true");
      await expect(technology).toBeInViewport({ ratio: 0.95 });
      await expect
        .poll(() =>
          page
            .locator(".hub-workspace-stage")
            .evaluate((el) => el.getBoundingClientRect().bottom),
        )
        .toBeLessThan(viewport.height);
    }
    await page.setViewportSize({ width: 667, height: 375 });
    await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
      "data-scroll",
      "false",
    );
    const recruitment = tabs(page).getByRole("tab", {
      name: "Recruitment Company",
      exact: true,
    });
    await recruitment.tap();
    const action = page
      .getByRole("tabpanel", { name: "Recruitment Company", exact: true })
      .getByRole("link");
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
      "data-scroll",
      "true",
    );
    await expect(recruitment).toHaveAttribute("aria-selected", "true");
    await expect(recruitment).toBeInViewport({ ratio: 0.95 });
    await page
      .getByRole("link", { name: "Explore the full workflow", exact: true })
      .tap();
    await expect(
      page.locator("#lifecycle .hub-section-heading"),
    ).toBeInViewport();
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
