import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "sales.spec.ts",
  outputDir: "./qa-artifacts/sales-live/results",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SALES_LIVE_BASE_URL || "http://127.0.0.1:15330",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --mode live --port 15330 --strictPort",
    url: "http://127.0.0.1:15330",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18160" },
    timeout: 30000,
  },
});
