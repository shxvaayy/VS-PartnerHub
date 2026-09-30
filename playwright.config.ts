import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "artifacts/local-verification/browser-report.json" },
    ],
  ],
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the same Playwright-managed browser locally and in CI by default.
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:5183/api/health",
    reuseExistingServer: false,
    timeout: 90000,
  },
});
