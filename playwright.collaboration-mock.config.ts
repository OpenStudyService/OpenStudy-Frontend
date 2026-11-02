import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: [
    "collaboration.spec.ts",
    "tasks.spec.ts",
    "responsive.spec.ts",
    "smoke.spec.ts",
  ],
  outputDir: "./qa-artifacts/collaboration-mock/results",
  use: { ...base.use, baseURL: "http://127.0.0.1:15187" },
  webServer: {
    command: "npm run dev -- --port 15187 --strictPort",
    url: "http://127.0.0.1:15187",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
