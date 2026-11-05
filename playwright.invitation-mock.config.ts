import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "invitations.spec.ts",
  testIgnore: ["**/live/**", "**/builds/**"],
  outputDir: "./qa-artifacts/invitation-mock/results",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15179",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 15179 --strictPort",
    url: "http://127.0.0.1:15179",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
