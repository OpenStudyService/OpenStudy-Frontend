import { defineConfig } from "@playwright/test";
import workforce from "./playwright.workforce.config";
export default defineConfig({
  ...workforce,
  testMatch: ["workforce.spec.ts", "attendance.spec.ts"],
  outputDir: "./qa-artifacts/attendance-live/results",
  webServer: {
    command: "npm run dev:live -- --port 15229 --strictPort",
    url: "http://127.0.0.1:15229",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18130" },
    timeout: 30000,
  },
});
