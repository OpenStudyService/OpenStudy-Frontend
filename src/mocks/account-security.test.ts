// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
import { mockResetMailToken } from "./account-security";
import { store } from "./store";

const server = setupServer(...handlers);
const origin = "http://localhost";
beforeAll(() => {
  vi.stubGlobal("location", new URL(origin));
  server.listen();
});
beforeEach(() => {
  store.reset();
  store.persona = "owner";
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function post(path: string, body?: object, csrf = true) {
  return fetch(`${origin}/api${path}`, {
    method: "POST",
    headers: {
      ...(csrf ? { "X-CSRF-Token": "openstudy-mock-csrf" } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body && JSON.stringify(body),
  });
}

it("changes the password without ending the current session", async () => {
  const version = store.user().version;
  const same = await post("/me/password", {
    currentPassword: "fixture-password",
    newPassword: "fixture-password",
  });
  expect(await same.json()).toMatchObject({
    code: "PASSWORD_SAME_AS_CURRENT",
    fieldErrors: { newPassword: expect.any(String) },
  });
  expect(
    (
      await post("/me/password", {
        currentPassword: "fixture-password",
        newPassword: "  new password  ",
      })
    ).status,
  ).toBe(204);
  expect(store.persona).toBe("owner");
  expect(store.user().version).toBe(version);
  const wrong = await post("/me/password", {
    currentPassword: "fixture-password",
    newPassword: "another password",
  });
  expect(await wrong.json()).toMatchObject({
    code: "CURRENT_PASSWORD_MISMATCH",
    fieldErrors: { currentPassword: expect.any(String) },
  });
  expect(await (await post("/employees/owner/login-unlock")).json()).toEqual({
    employeeId: "owner",
    wasLocked: true,
  });
  expect(await (await post("/employees/owner/login-unlock")).json()).toEqual({
    employeeId: "owner",
    wasLocked: false,
  });
});

it("queues delivery, invalidates replaced and consumed links, and completes anonymously with CSRF", async () => {
  const endpoint = "/employees/junho/password-reset";
  const response = await post(endpoint);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    employeeId: "junho",
    requestedAt: expect.any(String),
    delivery: "PENDING",
  });
  const replaced = mockResetMailToken("junho")!;
  await post(endpoint);
  const token = mockResetMailToken("junho")!;
  expect(token).not.toBe(replaced);
  store.persona = null;
  expect(
    (await post("/password-resets/preview", { token }, false)).status,
  ).toBe(403);
  expect(
    await (await post("/password-resets/preview", { token: replaced })).json(),
  ).toMatchObject({ code: "PASSWORD_RESET_LINK_INVALID" });
  expect(
    await (await post("/password-resets/preview", { token })).json(),
  ).toEqual({
    emailHint: expect.stringContaining("***@"),
    expiresAt: expect.any(String),
  });
  const clock = vi.spyOn(store, "now").mockReturnValue("2100-01-01T00:00:00Z");
  const expired = await post("/password-resets/preview", { token });
  expect(await expired.json()).toMatchObject({
    code: "PASSWORD_RESET_LINK_INVALID",
  });
  clock.mockRestore();
  expect(
    (
      await post("/password-resets/complete", {
        token,
        newPassword: "new fixture password",
      })
    ).status,
  ).toBe(204);
  expect(store.persona).toBeNull();
  expect(
    await (await post("/password-resets/preview", { token })).json(),
  ).toMatchObject({ code: "PASSWORD_RESET_LINK_INVALID" });
});

it("rejects self reset and unauthorized employee actions", async () => {
  const self = await post("/employees/owner/password-reset");
  expect(self.status).toBe(403);
  expect(await self.json()).toMatchObject({ code: "SELF_RESET_FORBIDDEN" });
  store.persona = "junho";
  expect((await post("/employees/owner/login-unlock")).status).toBe(404);
});

it("validates the multipart signature, serves photos, and returns the current user on delete", async () => {
  const upload = (bytes: Uint8Array<ArrayBuffer>) => {
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "image/png" }), "avatar.png");
    return fetch(`${origin}/api/me/avatar`, {
      method: "PUT",
      headers: { "X-CSRF-Token": "openstudy-mock-csrf" },
      body,
    });
  };
  const bad = await upload(Uint8Array.of(0, 1));
  expect(bad.status).toBe(422);
  expect(await bad.json()).toMatchObject({
    code: "AVATAR_TYPE_UNSUPPORTED",
    fieldErrors: { file: expect.any(String) },
  });
  const big = await upload(new Uint8Array(5_242_881));
  expect(big.status).toBe(422);
  expect(await big.json()).toMatchObject({
    code: "AVATAR_TOO_LARGE",
    fieldErrors: { file: expect.any(String) },
  });
  const good = await upload(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  );
  expect(good.status).toBe(200);
  const { user } = await good.json();
  expect(user.avatar).toMatch(/^\/api\/employees\/owner\/avatar\?v=/);
  const photo = await fetch(`${origin}${user.avatar}`);
  expect(photo.status).toBe(200);
  expect(photo.headers.get("Content-Type")).toBe("image/png");
  const removed = await fetch(`${origin}/api/me/avatar`, {
    method: "DELETE",
    headers: { "X-CSRF-Token": "openstudy-mock-csrf" },
  });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({
    user: { avatar: "", version: user.version + 1 },
  });
});
