import assert from "node:assert/strict";
import { test } from "node:test";
import { Progress, SendGuard, readSettings } from "./invitation-real-mail.ts";

const recipient = "controlled@example.test";
const env = {
  INVITATION_REAL_MAIL_BASE_URL: "https://study.example.test",
  INVITATION_REAL_MAIL_RECIPIENT: recipient,
};
const invite = {
  id: "31",
  branchId: "7",
  email: recipient,
  status: "초대 대기",
};
function created() {
  const p = new Progress(recipient);
  p.observe("manager", "/api/invitations", "POST", invite);
  return p;
}
function accepted() {
  const p = created();
  p.observe("employee", "/api/invitations/preview", "POST", {
    email: recipient,
    branch: { id: "7" },
    acceptanceMode: "NEW_ACCOUNT",
  });
  p.observe("employee", "/api/invitations/accept", "POST", {
    invitationId: "31",
    nextAction: "LOGIN_FOR_APPROVAL_STATUS",
  });
  return p;
}
function pending() {
  const p = accepted();
  p.observe("employee", "/api/auth/login", "POST", {
    sessionMode: "APPROVAL_ONLY",
    user: { email: recipient, status: "승인 대기" },
  });
  return p;
}
function approved() {
  const p = pending();
  p.observe("manager", "/api/invitations/31/approve", "POST", {
    id: "31",
    status: "활성",
  });
  p.observe("employee", "/api/invitations/approval-status", "GET", {
    requiresLogin: true,
    invitations: [{ invitationId: "31", status: "활성" }],
  });
  return p;
}
function workspace(p: Progress, email = recipient, branch = "7") {
  p.observe("employee", "/api/auth/login", "POST", {
    sessionMode: "WORKSPACE",
    user: { email, status: "활성", memberships: [{ branchId: branch }] },
  });
}

test("requires an explicitly selected recipient and origin without leaking values", () => {
  assert.throws(() => readSettings({}), { message: "BASE_URL_REQUIRED" });
  assert.throws(
    () =>
      readSettings({
        ...env,
        INVITATION_REAL_MAIL_RECIPIENT: "secret-invalid",
      }),
    { message: "TEST_RECIPIENT_REQUIRED" },
  );
  assert.deepEqual(readSettings(env), {
    baseURL: "https://study.example.test",
    recipient,
    timeoutMs: 900000,
  });
});
test("allows loopback HTTP while rejecting remote HTTP and secret-bearing URLs", () => {
  for (const base of [
    "http://127.0.0.1:15176",
    "http://localhost:15176",
    "http://[::1]:15176",
  ])
    assert.ok(readSettings({ ...env, INVITATION_REAL_MAIL_BASE_URL: base }));
  for (const base of [
    "http://study.example.test",
    "https://u:p@study.example.test",
    "https://study.example.test/app",
    "https://study.example.test/?token=secret",
    "https://study.example.test/#token=secret",
  ])
    assert.throws(
      () => readSettings({ ...env, INVITATION_REAL_MAIL_BASE_URL: base }),
      { message: "BASE_URL_MUST_BE_A_TRUSTED_ROOT_ORIGIN" },
    );
});
test("caps the operator waiting period and rejects invalid settings", () => {
  for (const value of ["0", "61", "1.5", "bad"])
    assert.throws(
      () =>
        readSettings({ ...env, INVITATION_REAL_MAIL_TIMEOUT_MINUTES: value }),
      { message: "TIMEOUT_MUST_BE_1_TO_60_MINUTES" },
    );
});
test("blocks another recipient and any second send attempt even after a network failure", () => {
  const guard = new SendGuard(recipient);
  assert.equal(guard.allow({ email: "other@example.test" }), false);
  assert.equal(guard.allow({ email: recipient }), true);
  assert.equal(guard.allow({ email: recipient }), false);
});
test("validates that the opened mail is for this run and a new account", () => {
  assert.throws(
    () =>
      created().observe("employee", "/api/invitations/preview", "POST", {
        email: "other@example.test",
        branch: { id: "7" },
        acceptanceMode: "NEW_ACCOUNT",
      }),
    { message: "MAIL_LINK_MISMATCH" },
  );
  assert.throws(
    () =>
      created().observe("employee", "/api/invitations/preview", "POST", {
        email: recipient,
        branch: { id: "7" },
        acceptanceMode: "EXISTING_ACCOUNT",
      }),
    { message: "NEW_ACCOUNT_REQUIRED" },
  );
});
test("requires acceptance of this invitation and restricted login before approval", () => {
  assert.throws(
    () =>
      created().observe("employee", "/api/invitations/accept", "POST", {
        invitationId: "31",
        nextAction: "LOGIN_FOR_APPROVAL_STATUS",
      }),
    { message: "ACCEPTANCE_RESPONSE_MISMATCH" },
  );
  assert.throws(
    () =>
      accepted().observe("manager", "/api/invitations/31/approve", "POST", {
        id: "31",
        status: "활성",
      }),
    { message: "APPROVAL_MUST_FOLLOW_RESTRICTED_LOGIN" },
  );
});
test("does not accept an approval or workspace belonging to a different invitation or branch", () => {
  const p = pending();
  p.observe("manager", "/api/invitations/32/approve", "POST", {
    id: "32",
    status: "활성",
  });
  assert.equal(p.approved, false);
  const other = approved();
  other.observe("employee", "/api/auth/logout", "POST", {});
  workspace(other, recipient, "8");
  assert.equal(other.workspace, false);
});
test("requires an observed logout and relogin after approval", () => {
  const p = approved();
  workspace(p);
  assert.equal(p.workspace, false);
  p.observe("employee", "/api/auth/logout", "POST", {});
  workspace(p);
  assert.equal(p.workspace, true);
});
test("rejects another employee login without retaining credentials or token metadata", () => {
  const p = approved();
  assert.throws(() => workspace(p, "other@example.test"), {
    message: "EMPLOYEE_ACCOUNT_MISMATCH",
  });
  assert.equal(JSON.stringify(p).includes("password"), false);
  assert.equal(JSON.stringify(p).includes("token"), false);
});
