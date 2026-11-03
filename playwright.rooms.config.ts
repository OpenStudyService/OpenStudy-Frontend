import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "rooms.spec.ts",
  outputDir: "./qa-artifacts/rooms-live/results",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15188",
    actionTimeout: 15000,
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15188 --strictPort",
    url: "http://127.0.0.1:15188",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18096" },
    timeout: 30000,
  },
});
