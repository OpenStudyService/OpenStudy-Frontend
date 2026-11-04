import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**", "**/builds/**"],
  grep: /mock schedule|leave approval|all screens fit|three themes/,
  testMatch: ["workforce.spec.ts", "extended.spec.ts", "responsive.spec.ts"],
  outputDir: "./qa-artifacts/workforce-mock/results",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15230",
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 15230 --strictPort",
    url: "http://127.0.0.1:15230",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
