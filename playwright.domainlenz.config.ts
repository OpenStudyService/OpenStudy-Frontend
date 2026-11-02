import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**", "**/builds/**"],
  testMatch: [
    "domainlenz.spec.ts",
    "chat.spec.ts",
    "tasks.spec.ts",
    "responsive.spec.ts",
  ],
  outputDir: "./test-results-domainlenz",
  timeout: 90000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5186",
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5186 --strictPort",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
