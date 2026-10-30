import { defineConfig } from "@playwright/test";

// Explicitly separate real-server checks from the default MSW suite.
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "invitations.spec.ts",
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15176",
    browserName: "chromium",
    channel: "chrome",
    // Mail tokens and passwords must not enter request-body traces.
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:live -- --port 15176 --strictPort",
    url: "http://127.0.0.1:15176",
    reuseExistingServer: false,
    env: { API_PROXY_TARGET: "http://127.0.0.1:18086" },
    timeout: 30000,
  },
});
