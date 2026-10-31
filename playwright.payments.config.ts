import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "payments.spec.ts",
  outputDir: "./qa-artifacts/payment-live/results",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PAYMENT_LIVE_BASE_URL || "http://127.0.0.1:15180",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15180 --strictPort",
    url: "http://127.0.0.1:15180",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18090" },
    timeout: 30000,
  },
});
