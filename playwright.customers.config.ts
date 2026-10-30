import { defineConfig } from "@playwright/test";

// Dedicated disposable Backend/MySQL environment; no credentials or MSW in this config.
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "customers.spec.ts",
  outputDir: "./qa-artifacts/customer-live/results",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15179",
    browserName: "chromium",
    channel: "chrome",
    // Authentication and customer request bodies must not enter traces.
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15179 --strictPort",
    url: "http://127.0.0.1:15179",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18089" },
    timeout: 30000,
  },
});
