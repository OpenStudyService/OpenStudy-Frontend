/** HTTP fixtures verify the transport boundary; they do not prove Backend storage. */
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { clearCsrf } from "../../shared/api/client";
import { canonicalChatApi } from "./canonical";
const calls: {
  path: string;
  body: unknown;
  csrf: string | null;
  key: string | null;
}[] = [];
const response = {
  lastReadMessageId: "9007199254740995",
  lastReadAt: "2026-11-03T00:00:00Z",
  unreadCount: 1,
  mainUnreadCount: 0,
  replyUnreadCount: 1,
};
const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "fixture-csrf" }),
  ),
  http.post("/api/channels/:id/read", async ({ request }) => {
    calls.push({
      path: new URL(request.url).pathname,
      body: await request.json(),
      csrf: request.headers.get("X-CSRF-Token"),
      key: request.headers.get("Idempotency-Key"),
    });
    return HttpResponse.json(response);
  }),
  http.post(
    "/api/channels/:id/messages/:parent/read",
    async ({ request, params }) => {
      calls.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
        csrf: request.headers.get("X-CSRF-Token"),
        key: request.headers.get("Idempotency-Key"),
      });
      return HttpResponse.json({
        ...response,
        messageId: params.parent,
        threadUnreadCount: 0,
      });
    },
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
  clearCsrf();
});
afterAll(() => server.close());
it("sends CSRF and exact independent positions without request keys over HTTP", async () => {
  const signal = new AbortController().signal;
  await canonicalChatApi.read("1", "", "9007199254740993", signal);
  await canonicalChatApi.read("1", "9", "9007199254740994", signal);
  expect(calls).toEqual([
    {
      path: "/api/channels/1/read",
      body: { messageId: "9007199254740993" },
      csrf: "fixture-csrf",
      key: null,
    },
    {
      path: "/api/channels/1/messages/9/read",
      body: { replyId: "9007199254740994" },
      csrf: "fixture-csrf",
      key: null,
    },
  ]);
});
it("preserves a server's field error and never treats it as a receipt", async () => {
  server.use(
    http.post("/api/channels/:id/read", () =>
      HttpResponse.json(
        {
          code: "INVALID_READ_TARGET",
          message: "원문만 지정",
          fieldErrors: { messageId: "원문 필요" },
        },
        { status: 422 },
      ),
    ),
  );
  await expect(
    canonicalChatApi.read("1", "", "99", new AbortController().signal),
  ).rejects.toMatchObject({
    status: 422,
    detail: {
      code: "INVALID_READ_TARGET",
      fieldErrors: { messageId: "원문 필요" },
    },
  });
});
