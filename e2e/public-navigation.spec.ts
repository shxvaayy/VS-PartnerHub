import { expect, test } from "@playwright/test";

test("desktop hover opens menus without moving focus and keeps the path into a dropdown usable", async ({
  page,
}) => {
  await page.goto("/");
  const platform = page.locator("#public-platform-trigger");
  const audience = page.locator("#public-workspaces-trigger");
  const panel = page.locator("#public-platform-panel");
  await platform.hover();
  await expect(platform).toHaveAttribute("aria-expanded", "true");
  await expect(platform).not.toBeFocused();

  const triggerBox = (await platform.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  await page.mouse.move(
    triggerBox.x + triggerBox.width / 2,
    (triggerBox.y + triggerBox.height + panelBox.y) / 2,
    { steps: 8 },
  );
  // A user can pause between the trigger and panel, beyond the close delay.
  await page.waitForTimeout(350);
  await expect(panel).toBeVisible();
  await panel
    .getByRole("link", { name: /Intelligence for everyday work/ })
    .hover();
  await expect(panel).toBeVisible();
  await audience.hover();
  await expect(audience).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeHidden();
  await page.mouse.move(8, 220);
  await expect(audience).toHaveAttribute("aria-expanded", "false");

  await platform.hover();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(platform).not.toBeFocused();
});

test("hover, click and keyboard activation cooperate without closing the menu on its first click", async ({
  page,
}) => {
  await page.goto("/");
  const platform = page.locator("#public-platform-trigger");
  const panel = page.locator("#public-platform-panel");
  await platform.hover();
  await expect(panel).toBeVisible();
  await platform.click();
  await expect(panel).toBeVisible();
  await platform.click();
  await expect(panel).toBeHidden();
  await platform.press("ArrowDown");
  await expect(
    panel.getByRole("link", { name: "Explore the platform", exact: true }),
  ).toBeFocused();
  await page.mouse.move(8, 220);
  await page.waitForTimeout(300);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(platform).toBeFocused();
  await expect(panel).toBeHidden();
  await platform.press("Enter");
  await expect(panel).toBeVisible();
  await page.mouse.click(8, 220);
  await expect(panel).toBeHidden();
  await platform.press("ArrowUp");
  await expect(panel.locator("a").last()).toBeFocused();
  await page.mouse.wheel(0, 240);
  await expect(panel).toBeHidden();
});

test.describe("Touch input", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 900 },
  });

  test("tablet navigation opens and closes on tap without relying on hover", async ({
    page,
  }) => {
    await page.goto("/");
    const platform = page.locator("#public-platform-trigger");
    const panel = page.locator("#public-platform-panel");
    await platform.tap();
    await expect(panel).toBeVisible();
    await platform.tap();
    await expect(panel).toBeHidden();
    await platform.tap();
    await panel
      .getByRole("link", { name: /Intelligence for everyday work/ })
      .tap();
    await expect(page).toHaveURL(/\/#intelligence$/);
    await expect(panel).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1024);
  });
});

test("compact navigation fits phones and tablets, cleans up on resize and keeps short-screen menus scrollable", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  for (const width of [1023, 834, 800, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const trigger = page.getByRole("button", {
      name: "Open menu",
      exact: true,
    });
    await expect(trigger).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#public-platform-trigger")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await trigger.click();
    const drawer = page.locator("#public-mobile-navigation");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: "Register your organization" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
  }

  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 400 });
  await expect(page.locator("#public-mobile-navigation")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  const audience = page.locator("#public-workspaces-trigger");
  await audience.press("ArrowDown");
  const panel = page.locator("#public-workspaces-panel");
  const last = panel.locator("a").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(panel).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("short-screen-dropdown.png"),
  });
  await page.setViewportSize({ width: 834, height: 900 });
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(panel).toBeHidden();
});
