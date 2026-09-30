import { expect, test, type CDPSession, type Page } from "@playwright/test";
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
    const group = track.querySelector<HTMLElement>(
      ".hub-workspace-presentation",
    )!;
    const top = Number.parseFloat(getComputedStyle(group).top);
    return {
      start: window.scrollY + track.getBoundingClientRect().top - top,
      distance: track.clientHeight - group.offsetHeight,
      top,
      cardTop:
        top +
        stage.getBoundingClientRect().top -
        group.getBoundingClientRect().top,
    };
  });
}
async function move(page: Page, top: number) {
  await page.evaluate(
    (top) => window.scrollTo({ top, behavior: "instant" }),
    top,
  );
}

async function swipe(page: Page, session: CDPSession, distance: number) {
  // Wait for the sticky card's new position to reach the compositor before
  // sending input. A completed scrollTo alone does not guarantee a painted frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const x = page.viewportSize()!.width / 2;
  const startY = distance < 0 ? 500 : 180;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY, id: 1 }],
  });
  try {
    // Send native touch input directly; the browser performs the scrolling.
    // The higher-level gesture synthesizer did not scroll on the Linux runner.
    for (let step = 1; step <= 16; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY + (distance * step) / 16, id: 1 }],
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    // Hold the finger still before lifting so inertia cannot skip another role.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const started = performance.now();
          function frame() {
            if (performance.now() - started >= 150) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
}

test.describe("Public workspace scroll tour", () => {
  test.use({ reducedMotion: "no-preference" });

  test("pins the heading and card together, visits all nine workspaces in both directions and releases after the last", async ({
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
      ).toBeCloseTo(geometry.cardTop, 0);
      await expect(
        page.locator("#workspaces .hub-section-heading"),
      ).toBeInViewport({ ratio: 1 });
      expect(
        await page
          .locator(".hub-workspace-presentation")
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
        const box = el
          .closest(".hub-workspace-presentation")!
          .getBoundingClientRect();
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
    ).toBeLessThan(geometry.cardTop - 170);
    expect(
      await page
        .locator("#workspaces .hub-section-heading")
        .evaluate((el) => el.getBoundingClientRect().top),
    ).toBeLessThan(geometry.top - 170);
    await page.locator("#lifecycle").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("tablist", { name: "Procurement lifecycle" }),
    ).toBeInViewport();
  });

  test("laptop layouts keep the full heading and card visible with compact section spacing", async ({
    page,
  }) => {
    for (const [width, height] of [
      [1280, 720],
      [1366, 768],
      [1024, 768],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      const geometry = await tour(page);
      await move(page, geometry.start + geometry.distance / 2);
      await expect(
        tabs(page).getByRole("tab", { name: "Staffing Company", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator("#workspaces .hub-section-heading"),
      ).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".hub-workspace-stage")).toBeInViewport({
        ratio: 1,
      });
      // Inspect settled spacing after the section's entrance transition.
      await page
        .locator("#workspaces .hub-section-heading")
        .evaluate(async (element) =>
          Promise.all(
            element
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          ),
        );
      const spacing = await page.locator("#workspaces").evaluate((section) => {
        const style = getComputedStyle(section);
        const heading = section
          .querySelector(".hub-section-heading")!
          .getBoundingClientRect();
        const card = section
          .querySelector(".hub-workspace-stage")!
          .getBoundingClientRect();
        const header = document
          .querySelector(".public-header")!
          .getBoundingClientRect();
        return {
          topPadding: Number.parseFloat(style.paddingTop),
          bottomPadding: Number.parseFloat(style.paddingBottom),
          gap: card.top - heading.bottom,
          belowHeader: heading.top - header.bottom,
          bottom: card.bottom,
          overflows: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(spacing.topPadding).toBeLessThanOrEqual(48);
      expect(spacing.bottomPadding).toBeLessThanOrEqual(48);
      expect(spacing.gap).toBeGreaterThanOrEqual(16);
      expect(spacing.gap).toBeLessThanOrEqual(25);
      expect(spacing.belowHeader).toBeGreaterThanOrEqual(10);
      expect(spacing.bottom).toBeLessThanOrEqual(height - 10);
      expect(spacing.overflows).toBe(false);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`workspace-heading-${width}x${height}.png`),
      });
    }
  });

  test("direct tabs and keyboard selection stay synchronized with scrolling", async ({
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
      .locator("#lifecycle .hub-section-heading")
      .scrollIntoViewIfNeeded();
    await expect(
      page.locator("#lifecycle .hub-section-heading"),
    ).toBeInViewport();
  });
});

test.describe("Mobile workspace scroll tour", () => {
  test.use({ isMobile: true, hasTouch: true, reducedMotion: "no-preference" });

  for (const [width, height] of [
    [600, 920],
    [600, 820],
    [390, 844],
    [375, 667],
    [360, 640],
    [320, 568],
    [375, 550],
  ]) {
    test(`${width} × ${height}: heading and card stay together, scroll forward and backward, then release`, async ({
      page,
    }, testInfo) => {
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
        expect(box!.y).toBeCloseTo(geometry.cardTop, 0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height - 10);
        expect(height - box!.y - box!.height).toBeLessThanOrEqual(112);
        await expect(page.locator("#workspace-heading")).toBeInViewport({
          ratio: 1,
        });
        const group = await page
          .locator(".hub-workspace-presentation")
          .boundingBox();
        expect(group!.y).toBeCloseTo(geometry.top, 0);
        const header = await page.locator(".public-header").boundingBox();
        expect(group!.y - header!.height).toBeGreaterThanOrEqual(8);
        expect(group!.y - header!.height).toBeLessThanOrEqual(16);
        expect(
          await panel.locator(".hub-workspace-journey > div").count(),
        ).toBe(4);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      }
      const spacing = await page.locator("#workspaces").evaluate((element) => ({
        above: Number.parseFloat(getComputedStyle(element).paddingTop),
        below: Number.parseFloat(getComputedStyle(element).paddingBottom),
      }));
      expect(spacing.above).toBeLessThanOrEqual(24);
      expect(spacing.below).toBeLessThanOrEqual(24);
      await page.screenshot({
        path: testInfo.outputPath(`mobile-heading-${width}x${height}.png`),
      });
      await move(page, geometry.start + geometry.distance + 160);
      await expect(
        tabs(page).getByRole("tab", { name: "Other", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        await page
          .locator(".hub-workspace-stage")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBeLessThan(geometry.cardTop - 140);
      expect(
        await page
          .locator("#workspaces .hub-section-heading")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBeLessThan(geometry.top - 140);
      await page
        .locator("#lifecycle .hub-section-heading")
        .scrollIntoViewIfNeeded();
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
    await expect(page.locator(".hub-workspace-stage")).toBeInViewport({
      ratio: 1,
    });
    const session = await page.context().newCDPSession(page);
    try {
      for (const [distance, name] of [
        [-step * 1.1, "Supplier"],
        [step * 1.1, "Vendor"],
      ] as const) {
        await test.step(`Swipe to ${name}`, async () => {
          const before = await page.evaluate(() => window.scrollY);
          await swipe(page, session, distance);
          await expect
            .poll(async () => {
              const after = await page.evaluate(() => window.scrollY);
              return (after - before) * -Math.sign(distance);
            })
            .toBeGreaterThan(step * 0.8);
          await expect(
            tabs(page).getByRole("tab", { name, exact: true }),
          ).toHaveAttribute("aria-selected", "true");
        });
      }
    } finally {
      await session.detach();
    }
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
    await expect(page.locator("#workspace-heading")).toBeInViewport({
      ratio: 1,
    });
    // Mobile browser controls can reduce 100svh without changing the layout
    // viewport used by height media queries. Keep the whole card in that space.
    const browserControls = await page.addStyleTag({
      content: ".hub-workspace-track::before { height: 600px; }",
    });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect
      .poll(() =>
        page
          .locator(".hub-workspace-stage")
          .evaluate((el) => el.getBoundingClientRect().bottom),
      )
      .toBeLessThan(600);
    await expect(page.locator(".hub-workspace-track")).toHaveAttribute(
      "data-scroll",
      "true",
    );
    await expect(technology).toHaveAttribute("aria-selected", "true");
    await browserControls.evaluate((el) => el.remove());
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
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
      await expect(page.locator("#workspace-heading")).toBeInViewport({
        ratio: 1,
      });
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
      .locator("#lifecycle .hub-section-heading")
      .scrollIntoViewIfNeeded();
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
