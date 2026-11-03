import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: ["rooms.spec.ts", "responsive.spec.ts", "smoke.spec.ts"],
  outputDir: "./qa-artifacts/rooms-mock/results",
  use: { ...base.use, baseURL: "http://127.0.0.1:15189" },
  webServer: {
    command: "npm run dev -- --port 15189 --strictPort",
    url: "http://127.0.0.1:15189",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
