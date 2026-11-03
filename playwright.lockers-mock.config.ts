import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: ["lockers.spec.ts", "responsive.spec.ts", "smoke.spec.ts"],
  outputDir: "./qa-artifacts/lockers-mock/results",
  use: { ...base.use, baseURL: "http://127.0.0.1:15191" },
  webServer: {
    command: "npm run dev -- --port 15191 --strictPort",
    url: "http://127.0.0.1:15191",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
