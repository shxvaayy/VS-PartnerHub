import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openHome(page: Page) {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("region", { name: "Connected workspace overview" }),
  ).toBeVisible();
}

const workflows = (page: Page) =>
  page.getByRole("tablist", { name: "Explore business workflows" });
const currentStage = (page: Page) =>
  page.locator('.hub-track-panel:not([hidden]) [aria-current="step"]');

async function openTimedHome(page: Page) {
  await page.clock.install();
  await openHome(page);
  // Leave enough headroom for remote browser transport, then restart through
  // the real controls so each timed assertion begins at the same stage.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000));
  await workflows(page).getByRole("tab", { name: "Deliver & grow" }).click();
  await workflows(page).getByRole("tab", { name: "Source & procure" }).click();
  const play = page.getByRole("button", { name: "Play workflow animation" });
  if (await play.count()) await play.click();
}

test("desktop navigation opens real product destinations and supports keyboard dismissal", async ({
  page,
}) => {
  await openHome(page);
  for (const width of [1440, 1024, 834]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator(".public-header");
    const platform = header.getByRole("button", {
      name: "Platform",
      exact: true,
    });
    const panel = page.locator("#public-platform-panel");
    await platform.click();
    await expect(platform).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await platform.press("Tab");
    await expect(
      panel.getByRole("link", { name: "Explore the platform", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(platform).toBeFocused();
    await expect(panel).toBeHidden();
    const audience = header.getByRole("button", {
      name: "Who it’s for",
      exact: true,
    });
    await audience.click();
    await expect(
      page.locator('#public-workspaces-panel a[href^="/register?type="]'),
    ).toHaveCount(9);
    await expect(page.locator("#public-workspaces-panel")).toBeInViewport({
      ratio: 1,
    });
    await page.mouse.click(8, 120);
    await expect(audience).toHaveAttribute("aria-expanded", "false");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page
    .locator(".public-header")
    .getByRole("button", { name: "Platform", exact: true })
    .click();
  await page.locator('#public-platform-panel a[href="/#intelligence"]').click();
  await expect(page).toHaveURL(/\/#intelligence$/);
  await expect(page.locator("#intelligence h2")).toBeInViewport();
  await expect(page.locator("#public-platform-panel")).toBeHidden();
});

test("landing content stays readable at desktop, tablet and narrow phone widths", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openHome(page);
  for (const width of [1440, 1024, 800, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const header = await page.locator(".public-nav").evaluate((element) => {
      const brand = element.querySelector(".brand")!.getBoundingClientRect();
      const actions = element
        .querySelector(".public-nav-actions")!
        .getBoundingClientRect();
      return {
        height: element.getBoundingClientRect().height,
        gap: actions.left - brand.right,
      };
    });
    expect(header.gap).toBeGreaterThan(0);
    if (width <= 800) expect(header.height).toBeLessThanOrEqual(78);
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}.png`),
    });
    const network = page.locator(".hub-network");
    await network.scrollIntoViewIfNeeded();
    const geometry = await network.evaluate((element) => {
      const identity = element
        .querySelector(".hub-identity")!
        .getBoundingClientRect();
      const heading = element
        .querySelector(".hub-identity h2")!
        .getBoundingClientRect();
      const panel = element
        .querySelector(".hub-track-panel:not([hidden])")!
        .getBoundingClientRect();
      const badges = [
        ...element.querySelectorAll(".hub-network-bottom > span"),
      ].map((item) => item.getBoundingClientRect());
      const bounds = element.getBoundingClientRect();
      return {
        headingFits:
          heading.right <= identity.right && heading.left >= identity.left,
        badgesFit: badges.every(
          (badge) =>
            badge.top >= panel.bottom &&
            badge.right <= bounds.right &&
            badge.bottom <= bounds.bottom,
        ),
        badgesOverlap:
          badges[0].right > badges[1].left &&
          badges[0].top < badges[1].bottom &&
          badges[0].bottom > badges[1].top,
      };
    });
    expect(geometry).toEqual({
      headingFits: true,
      badgesFit: true,
      badgesOverlap: false,
    });
    await network.screenshot({
      path: testInfo.outputPath(`connected-workspace-${width}.png`),
    });
    expect(
      await page
        .locator(".public-header")
        .evaluate((element) => element.getBoundingClientRect().top),
    ).toBe(0);
  }
  await expect(page.getByText("Keep exploring", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Explore the full workflow", exact: true }),
  ).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe("Connected workspace animation", () => {
  test.use({ reducedMotion: "no-preference" });

  test("progresses through workflow stages; Pause, Play and manual selection remain in control", async ({
    page,
  }, testInfo) => {
    await openTimedHome(page);
    const network = page.locator(".hub-network");
    await expect(network).toHaveAttribute("data-running", "true");
    await expect(currentStage(page)).toContainText("Requirement");
    await page.clock.runFor(2400);
    await expect(currentStage(page)).toContainText("Quotation");
    await page.clock.runFor(2300);
    await expect(currentStage(page)).toContainText("Approved order");
    await network.screenshot({
      path: testInfo.outputPath("procurement-sequence.png"),
    });
    await page.clock.runFor(2300);
    await expect(
      workflows(page).getByRole("tab", { name: "Recruit & deploy" }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("button", { name: "Pause workflow animation" })
      .click();
    await expect(network).toHaveAttribute("data-running", "false");
    await page.clock.runFor(10000);
    await expect(currentStage(page)).toContainText("Hiring need");
    await page.getByRole("button", { name: "Play workflow animation" }).click();
    await expect(network).toHaveAttribute("data-running", "true");
    await page.clock.runFor(2400);
    await expect(currentStage(page)).toContainText("Candidate");
    const delivery = workflows(page).getByRole("tab", {
      name: "Deliver & grow",
    });
    await delivery.click();
    await expect(network).toHaveAttribute("data-running", "false");
    await expect(currentStage(page)).toContainText("Agreement");
    await page.clock.runFor(7000);
    await expect(delivery).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        page
          .locator("#track-panel-2")
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");
    await delivery.press("Home");
    await expect(
      workflows(page).getByRole("tab", { name: "Source & procure" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      workflows(page).getByRole("tab", { name: "Recruit & deploy" }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(delivery).toBeFocused();
    await expect(delivery).toHaveAttribute("aria-selected", "true");
  });

  test("pauses outside the viewport and resumes the same workflow", async ({
    page,
  }) => {
    await openTimedHome(page);
    const network = page.locator(".hub-network");
    await expect(network).toHaveAttribute("data-running", "true");
    await page.clock.runFor(2400);
    await expect(currentStage(page)).toContainText("Quotation");
    await page
      .locator("#trust")
      .evaluate((element) => element.scrollIntoView({ behavior: "instant" }));
    await expect(network).toHaveAttribute("data-running", "false");
    await page.clock.runFor(15000);
    await expect(currentStage(page)).toContainText("Quotation");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(network).toHaveAttribute("data-running", "true");
    await page.clock.runFor(2300);
    await expect(currentStage(page)).toContainText("Approved order");
  });
});

test("reduced motion keeps every workflow available without automatic movement", async ({
  page,
}) => {
  await openTimedHome(page);
  const network = page.locator(".hub-network");
  await expect(network).toHaveAttribute("data-running", "false");
  await expect(
    page.getByRole("button", { name: /workflow animation/ }),
  ).toHaveCount(0);
  await page.clock.runFor(30000);
  await expect(
    workflows(page).getByRole("tab", { name: "Source & procure" }),
  ).toHaveAttribute("aria-selected", "true");
  for (const name of [
    "Recruit & deploy",
    "Deliver & grow",
    "Source & procure",
  ]) {
    await workflows(page).getByRole("tab", { name, exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name, exact: true }),
    ).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Play workflow animation" }).click();
  await expect(network).toHaveAttribute("data-running", "true");
  await page.clock.runFor(2400);
  await expect(currentStage(page)).toContainText("Quotation");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(network).toHaveAttribute("data-running", "false");
  await page.clock.runFor(10000);
  await expect(currentStage(page)).toContainText("Quotation");
  await expect(network.locator(".hub-connection-signal")).toBeHidden();
});

test("the branded loading ring follows a pending page load and respects reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Hold the actual lazy-loaded page module, then release the same request.
  // The product itself does not add an artificial loading delay.
  await page.route(
    /\/(?:src\/pages\/Public\.tsx|assets\/Public-[^/]+\.js)(?:\?.*)?$/,
    async (route) => {
      await pending;
      await route.continue();
    },
  );
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const loader = page
      .getByRole("status")
      .filter({ hasText: "Loading VS PartnerHub" });
    await expect(loader).toBeVisible();
    const ring = loader.locator(".brand-loader-orbit");
    const start = await ring.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expect
      .poll(() =>
        ring.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(start);
    await expect(loader.locator(".brand-loader-logo")).toBeVisible();
    await expect
      .poll(() =>
        loader
          .locator(".brand-loader-logo")
          .evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe("none");
    await loader.screenshot({
      path: testInfo.outputPath("branded-loading.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        ring.evaluate((element) => getComputedStyle(element).animationName),
      )
      .toBe("none");
    release();
    await expect(page.locator(".hub-hero h1")).toBeVisible();
    await expect(loader).toHaveCount(0);
  } finally {
    release();
  }
});
