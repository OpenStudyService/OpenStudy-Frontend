import { afterEach, expect, it, vi } from "vitest";
import { api, clearCsrf } from "./client";
afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrf();
});
it("refreshes the CSRF token after session creation instead of reusing the anonymous token", async () => {
  const headers: string[] = [];
  let csrfRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/csrf")) {
        csrfRequests++;
        return Response.json({ token: `csrf-${csrfRequests}` });
      }
      headers.push(new Headers(init?.headers).get("X-CSRF-Token") || "");
      return Response.json({ ok: true });
    }),
  );
  await api("/auth/login", {
    method: "POST",
    body: { email: "owner@openstudy.test", password: "not-saved" },
  });
  await api("/tasks", { method: "POST", body: { title: "세션 갱신 후 업무" } });
  expect(csrfRequests).toBe(2);
  expect(headers).toEqual(["csrf-1", "csrf-2"]);
});
