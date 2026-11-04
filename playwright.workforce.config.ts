import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "workforce.spec.ts",
  outputDir: "./qa-artifacts/workforce-live/results",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15229",
    browserName: "chromium",
    channel: "chrome",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15229 --strictPort",
    url: "http://127.0.0.1:15229",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18129" },
    timeout: 30000,
  },
});
