import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/builds",
  outputDir: "./test-results-builds",
  timeout: 45000,
  workers: 1,
  reporter: "list",
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run preview -- --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --outDir dist-demo --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
    },
  ],
});
