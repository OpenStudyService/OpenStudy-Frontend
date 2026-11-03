import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  timeout: 90000,
  testMatch: ["chat.spec.ts", "responsive.spec.ts", "smoke.spec.ts"],
  outputDir: "./qa-artifacts/chat-read-mock/results",
  use: { ...base.use, baseURL: "http://127.0.0.1:15195" },
  webServer: {
    command: "npm run dev -- --port 15195 --strictPort",
    url: "http://127.0.0.1:15195",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
