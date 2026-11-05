import { defineConfig } from "@playwright/test";
import workforce from "./playwright.workforce-mock.config";
export default defineConfig({
  ...workforce,
  testMatch: [
    "attendance.spec.ts",
    "workforce.spec.ts",
    "extended.spec.ts",
    "responsive.spec.ts",
  ],
  grep: /mock attendance|mock schedule|leave approval|all screens fit|three themes/,
  outputDir: "./qa-artifacts/attendance-mock/results",
});
