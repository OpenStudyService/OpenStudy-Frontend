import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**", "**/builds/**"],
  testMatch: [
    "sales.spec.ts",
    "responsive.spec.ts",
    "smoke.spec.ts",
    "workflows.spec.ts",
  ],
  outputDir: "./qa-artifacts/sales-mock/results",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15331",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --mode mock --port 15331 --strictPort",
    url: "http://127.0.0.1:15331",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
