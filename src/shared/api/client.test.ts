import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, clearCsrf } from "./client";
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

it("keeps conflict details, request ID and retry instructions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          code: "VERSION_CONFLICT",
          message: "입력을 유지해 주세요.",
          requestId: "body-id",
          latestVersion: 3,
          reloadUrl: "/api/branches/1",
        },
        {
          status: 409,
          headers: { "X-Request-ID": "server-id", "Retry-After": "2" },
        },
      ),
    ),
  );
  const error = (await api("/branches/1").catch((e) => e)) as ApiError;
  expect(error.status).toBe(409);
  expect(error.detail.latestVersion).toBe(3);
  expect(error.detail.reloadUrl).toBe("/api/branches/1");
  expect(error.retryAfter).toBe("2");
  expect(error.message).toContain("server-id");
});
it("uses safe HTTP fallback for malformed errors with a server request ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(null, {
        status: 503,
        headers: { "X-Request-ID": "req-unavailable" },
      }),
    ),
  );
  await expect(api("/lookups")).rejects.toMatchObject({
    status: 503,
    detail: { code: "HTTP_ERROR", requestId: "req-unavailable" },
  });
});
it("rejects a late response even when the transport ignores abort", async () => {
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = api("/lookups?scope=old", { signal: controller.signal });
  controller.abort();
  finish(Response.json({ branches: [{ id: "old" }] }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it.each([null, [], "invalid"])(
  "falls back safely for malformed error body %j",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status: 500 })),
    );
    await expect(api("/lookups")).rejects.toMatchObject({
      detail: { code: "HTTP_ERROR" },
    });
  },
);
it("discards non-string request IDs and removes control characters", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { code: "ERROR", message: "실패", requestId: { secret: true } },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { code: "ERROR", message: "실패", requestId: "req\u0000\n-safe" },
          { status: 500 },
        ),
      ),
  );
  const invalid = await api<never>("/lookups").catch((error: ApiError) => error);
  expect(invalid.detail.requestId).toBeUndefined();
  const valid = await api<never>("/lookups").catch((error: ApiError) => error);
  expect(valid.detail.requestId).toBe("req-safe");
});
it.each([401, 403])(
  "does not hide HTTP %s as an empty result",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "DENIED", message: "접근 불가" }, { status }),
      ),
    );
    await expect(api("/lookups")).rejects.toMatchObject({ status });
  },
);
it("reports network failure separately from an empty successful body", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 200 })),
  );
  await expect(api("/lookups")).rejects.toMatchObject({ status: 0 });
  await expect(api("/lookups")).resolves.toBeUndefined();
});

it("does not expire the new scope when an old unauthorized body arrives after abort", async () => {
  const controller = new AbortController();
  let finish!: (body: unknown) => void;
  const response = new Response(null, { status: 401 });
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
  const expire = vi.fn();
  window.addEventListener("openstudy:session-expired", expire);
  try {
    const pending = api("/lookups?scope=old", { signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    finish({ code: "SESSION_EXPIRED", message: "이전 요청" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(expire).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("openstudy:session-expired", expire);
  }
});
