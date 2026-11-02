import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "pass-history.spec.ts",
  outputDir: "./qa-artifacts/history-live/results",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15183",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15183 --strictPort",
    url: "http://127.0.0.1:15183",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18093" },
    timeout: 30000,
  },
});
