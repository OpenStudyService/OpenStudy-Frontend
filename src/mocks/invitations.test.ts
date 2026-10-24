import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import {
  invitationHandlers,
  invitationMailLink,
  resetInvitations,
  setInvitationSessionMode,
} from "./invitations";
import { store } from "./store";
const server = setupServer(...invitationHandlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  resetInvitations();
});
const request = (path: string, method = "GET", body?: object, csrf = true) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": "openstudy-mock-csrf" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
async function create(email = "new@example.test", role = "staff") {
  const r = await request("/invitations", "POST", {
    name: "초대 직원",
    email,
    branchId: "gangnam",
    role,
    permissions: [],
  });
  return r;
}
it("keeps tokens/passwords out of admin DTOs and persisted storage; new acceptance requires a later login", async () => {
  const i = await (await create()).json();
  const token = invitationMailLink(i.id);
  expect(JSON.stringify(i)).not.toMatch(/token|password/);
  const preview = await request("/invitations/preview", "POST", { token });
  expect(await preview.json()).toMatchObject({
    acceptanceMode: "NEW_ACCOUNT",
    branch: { id: "gangnam" },
  });
  store.persona = null;
  const accepted = await request("/invitations/accept", "POST", {
    mode: "NEW_ACCOUNT",
    token,
    email: i.email,
    password: "password-test",
  });
  expect(await accepted.json()).toMatchObject({
    nextAction: "LOGIN_FOR_APPROVAL_STATUS",
  });
  expect(store.persona).toBeNull();
  expect(JSON.stringify(sessionStorage)).not.toContain(token);
  expect(JSON.stringify(sessionStorage)).not.toContain("password-test");
  expect(
    (await request("/invitations/preview", "POST", { token })).status,
  ).toBe(410);
});
it("requires CSRF, same-email existing login, and restores only the invited revoked membership", async () => {
  const e = store.get("employees", "junho");
  e.memberships[0].status = "회수";
  const i = await (await create(e.email)).json();
  const token = invitationMailLink(i.id);
  expect(
    (await request("/invitations/preview", "POST", { token }, false)).status,
  ).toBe(403);
  expect(
    (
      await request("/invitations/accept", "POST", {
        mode: "EXISTING_ACCOUNT",
        email: e.email,
        token,
      })
    ).status,
  ).toBe(403);
  store.persona = e.id;
  expect(
    (
      await request("/invitations/accept", "POST", {
        mode: "EXISTING_ACCOUNT",
        email: e.email,
        token,
      })
    ).status,
  ).toBe(200);
  store.persona = "owner";
  const current = await (await request(`/invitations/${i.id}`)).json();
  expect(
    (
      await request(`/invitations/${i.id}/approve`, "POST", {
        version: current.version,
      })
    ).status,
  ).toBe(200);
  expect(e.memberships).toHaveLength(1);
  expect(e.memberships[0].status).toBe("활성");
});
it("rejects manager admin invitations and stale versions; reissue invalidates previous link", async () => {
  store.persona = "minji";
  expect((await create("manager@example.test", "admin")).status).toBe(403);
  store.persona = "owner";
  const i = await (await create()).json();
  const token = invitationMailLink(i.id);
  expect(
    (await request(`/invitations/${i.id}/reissue`, "POST", { version: 99 }))
      .status,
  ).toBe(409);
  expect(
    (
      await request(`/invitations/${i.id}/reissue`, "POST", {
        version: i.version,
      })
    ).status,
  ).toBe(200);
  expect(
    (await request("/invitations/preview", "POST", { token })).status,
  ).toBe(410);
});
it("shows rejection reasons only in the invitee's status and forces a limited approved session to login", async () => {
  const i = await (await create()).json(),
    token = invitationMailLink(i.id);
  await request("/invitations/accept", "POST", {
    mode: "NEW_ACCOUNT",
    token,
    email: i.email,
    password: "password-test",
  });
  const current = await (await request(`/invitations/${i.id}`)).json();
  await request(`/invitations/${i.id}/reject`, "POST", {
    version: current.version,
    reason: "소속 지점 확인 필요",
  });
  const e = store.db.employees.find((e) => e.email === i.email)!;
  store.persona = e.id;
  expect(
    await (await request("/invitations/approval-status")).json(),
  ).toMatchObject({
    invitations: [{ rejectionReason: "소속 지점 확인 필요" }],
  });
  e.status = "활성";
  setInvitationSessionMode(true);
  expect(
    await (await request("/invitations/approval-status")).json(),
  ).toMatchObject({ requiresLogin: true });
  store.persona = "junho";
  expect(
    await (await request("/invitations/approval-status")).json(),
  ).toMatchObject({ invitations: [] });
});
