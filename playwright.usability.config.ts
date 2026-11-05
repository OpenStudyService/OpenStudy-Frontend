import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "usability.spec.ts",
    "responsive.spec.ts",
    "products.spec.ts",
    "organization.spec.ts",
    "payments.spec.ts",
    "tasks.spec.ts",
    "customers.spec.ts",
    "workforce.spec.ts",
  ],
  testIgnore: ["**/builds/**", "**/live/**"],
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15180",
    channel: process.env.CI ? undefined : "chrome",
    actionTimeout: 10000,
    navigationTimeout: 15000,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 15180 --strictPort",
    url: "http://127.0.0.1:15180",
    reuseExistingServer: false,
  },
});
