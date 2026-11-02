import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "tasks.spec.ts",
  outputDir: "./qa-artifacts/task-live/results",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15181",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15181 --strictPort",
    url: "http://127.0.0.1:15181",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18091" },
    timeout: 30000,
  },
});
