import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: ["customer-spaces.spec.ts", "responsive.spec.ts", "smoke.spec.ts"],
  outputDir: "./qa-artifacts/customer-spaces-mock/results",
  use: { ...base.use, baseURL: "http://127.0.0.1:15193" },
  webServer: {
    command: "npm run dev -- --port 15193 --strictPort",
    url: "http://127.0.0.1:15193",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
