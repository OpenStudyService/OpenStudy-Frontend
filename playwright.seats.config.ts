import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "seats.spec.ts",
  outputDir: "./qa-artifacts/seat-live/results",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15182",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15182 --strictPort",
    url: "http://127.0.0.1:15182",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18092" },
    timeout: 30000,
  },
});
