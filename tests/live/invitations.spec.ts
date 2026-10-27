import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const ownerEmail = process.env.INVITATION_LIVE_OWNER_EMAIL;
const ownerPassword = process.env.INVITATION_LIVE_OWNER_PASSWORD;
const password = "Invitation-local-2026!";
const baseURL = "http://127.0.0.1:15176";
type Invitation = {
  id: string;
  version: number;
  email: string;
  status: string;
  expiresAt: string;
};

test.beforeAll(() => {
  if (!ownerEmail || !ownerPassword)
    throw new Error(
      "Use the disposable local server described in docs/testing/invitation-live.md and set INVITATION_LIVE_OWNER_EMAIL/PASSWORD.",
    );
});

async function command(context: BrowserContext, path: string, body: unknown) {
  const csrf = await context.request.get(`${baseURL}/api/auth/csrf`);
  const { token } = await csrf.json();
  return context.request.post(`${baseURL}/api${path}`, {
    headers: { "X-CSRF-Token": token, "Idempotency-Key": randomUUID() },
    data: body,
  });
}
async function login(page: Page, email: string, secret = password) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
async function owner(browser: Browser) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await login(page, ownerEmail!, ownerPassword!);
  const me = await (await context.request.get(`${baseURL}/api/me`)).json();
  return {
    context,
    page,
    branches: me.branches as { id: string; name: string }[],
  };
}
async function list(context: BrowserContext, email: string) {
  const response = await context.request.get(
    `${baseURL}/api/invitations?scope=all&pageSize=100&q=${encodeURIComponent(email)}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).items as Invitation[];
}
async function detail(context: BrowserContext, id: string) {
  const response = await context.request.get(
    `${baseURL}/api/invitations/${id}?scope=all`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as Invitation;
}
async function create(page: Page, branch: string, email: string, name: string) {
  await page.goto(`/app/${branch}/employees?tab=invitations`);
  await page.getByLabel("초대 이름", { exact: true }).fill(name);
  await page.getByLabel("초대 이메일 (발송 후 변경 불가)").fill(email);
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/invitations" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "초대 이메일 발송 요청" }).click();
  expect((await created).status()).toBe(201);
  await page.getByLabel("초대 이름·이메일 검색").fill(email);
  await expect(
    page.getByRole("button", { name: `초대 상세: ${name}`, exact: true }),
  ).toBeVisible();
  const invitation = (await list(page.context(), email)).find(
    (item) => item.email === email && item.status === "초대 대기",
  );
  expect(invitation).toBeTruthy();
  return invitation!;
}
async function mailLink(
  context: BrowserContext,
  email: string,
  previous?: string,
) {
  let link = "";
  await expect
    .poll(
      async () => {
        const inbox = await (
          await context.request.get("http://127.0.0.1:18025/api/v1/messages")
        ).json();
        for (const message of inbox.messages) {
          if (
            !message.To.some((to: { Address: string }) => to.Address === email)
          )
            continue;
          const mail = await (
            await context.request.get(
              `http://127.0.0.1:18025/api/v1/message/${message.ID}`,
            )
          ).json();
          const found = mail.Text.match(
            /http:\/\/127\.0\.0\.1:15176\/invitations\/accept#token=[A-Za-z0-9_-]+/,
          )?.[0];
          if (found && found !== previous) {
            link = found;
            return true;
          }
        }
        return false;
      },
      {
        timeout: 20000,
        message: "The local SMTP receiver has a new invitation message",
      },
    )
    .toBe(true);
  return link;
}
async function acceptNew(page: Page, link: string) {
  await page.goto(link);
  await expect(page.getByLabel("새 계정 비밀번호")).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/invitations/accept`);
  await page.getByLabel("새 계정 비밀번호").fill(password);
  await page.getByRole("button", { name: "초대 수락", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "초대 수락이 완료됐어요" }),
  ).toBeVisible();
}
async function approve(page: Page, branch: string, name: string) {
  await page.goto(`/app/${branch}/employees?tab=invitations`);
  await page
    .getByRole("button", { name: `초대 상세: ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "최종 승인", exact: true }).click();
  await expect(page.getByText(/활성 · 발송 완료 · 버전/)).toBeVisible();
}

test("real SMTP link: two-browser approval, restricted session, relogin, and an existing employee's second branch", async ({
  browser,
}) => {
  const manager = await owner(browser);
  const employee = await browser.newContext({ baseURL });
  try {
    expect(manager.branches.length).toBeGreaterThanOrEqual(2);
    const [first, second] = manager.branches;
    const suffix = randomUUID().slice(0, 8);
    const email = `new-${suffix}@invitation.test`,
      name = `신규 ${suffix}`;
    await create(manager.page, first.id, email, name);
    const link = await mailLink(manager.context, email);
    const page = await employee.newPage();
    const tokenRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && /token=/.test(request.url()))
        tokenRequests.push("query token");
    });
    await acceptNew(page, link);
    await page.getByRole("link", { name: "로그인으로 돌아가기" }).click();
    await login(page, email);
    await expect(
      page.getByRole("heading", { name: "최종 승인을 기다리고 있어요" }),
    ).toBeVisible();
    expect(
      (await employee.request.get(`${baseURL}/api/lookups`)).status(),
    ).toBe(403);
    const additionalName = `추가 ${suffix}`;
    const additional = await create(
      manager.page,
      second.id,
      email,
      additionalName,
    );
    const additionalLink = await mailLink(manager.context, email, link);
    const blocked = await command(employee, "/invitations/accept", {
      mode: "EXISTING_ACCOUNT",
      email,
      token: new URL(additionalLink).hash.slice(7),
    });
    expect(blocked.status()).toBe(403);
    await page.goto(additionalLink);
    await expect(
      page.getByText(/첫 지점의 최종 승인 후 다시 로그인해야/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "초대 수락", exact: true }),
    ).toBeDisabled();
    await page.goto("/pending-approval");
    await approve(manager.page, first.id, name);
    // Separate browser remains logged in; the 15-second poll observes approval.
    await expect(
      page.getByRole("heading", { name: "승인이 완료됐어요" }),
    ).toBeVisible({ timeout: 25000 });
    expect(
      (await employee.request.get(`${baseURL}/api/lookups`)).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "다시 로그인", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, email);
    await expect(page).toHaveURL(new RegExp(`/app/${first.id}/home$`));
    const oldSession = await (
      await employee.request.get(`${baseURL}/api/me`)
    ).json();
    expect(oldSession.sessionMode).toBe("WORKSPACE");
    await expect(
      page.getByRole("heading", { name: /안녕하세요/ }),
    ).toBeVisible();

    await page.goto(additionalLink);
    await expect(
      page.getByRole("button", { name: "초대 수락", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("기존 계정 비밀번호")).toHaveCount(0);
    await page.getByRole("button", { name: "초대 수락", exact: true }).click();
    await expect(page).toHaveURL(/\/pending-approval$/);
    const pending = await (
      await employee.request.get(`${baseURL}/api/me`)
    ).json();
    expect(pending.sessionMode).toBe("WORKSPACE");
    expect(
      pending.branches.some((branch: { id: string }) => branch.id === first.id),
    ).toBe(true);
    expect(
      pending.branches.some(
        (branch: { id: string }) => branch.id === second.id,
      ),
    ).toBe(false);
    await page.getByRole("link", { name: "기존 지점 업무로 돌아가기" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${first.id}/home$`));
    await approve(manager.page, second.id, additionalName);
    await page.reload();
    const active = await (
      await employee.request.get(`${baseURL}/api/me`)
    ).json();
    expect(
      active.branches.some((branch: { id: string }) => branch.id === second.id),
    ).toBe(true);
    await page.goto(`/app/${second.id}/home`);
    await expect(
      page.getByRole("heading", { name: /안녕하세요/ }),
    ).toBeVisible();
    expect((await detail(manager.context, additional.id)).status).toBe("활성");
    await page.screenshot({
      path: test.info().outputPath("approved-second-branch.png"),
      fullPage: true,
    });
    expect(tokenRequests).toEqual([]);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored.includes(new URL(link).hash.slice(7))).toBe(false);
    expect(stored.includes(password)).toBe(false);
  } finally {
    await employee.close();
    await manager.context.close();
  }
});

test("reissued and expired mail links are rejected, with CSRF enforced by the real server", async ({
  browser,
}) => {
  const manager = await owner(browser);
  const guest = await browser.newContext({ baseURL });
  try {
    const suffix = randomUUID().slice(0, 8),
      email = `expiry-${suffix}@invitation.test`,
      name = `만료 ${suffix}`;
    const invitation = await create(
      manager.page,
      manager.branches[0].id,
      email,
      name,
    );
    const oldLink = await mailLink(manager.context, email);
    await manager.page
      .getByRole("button", { name: `초대 상세: ${name}`, exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "새 24시간으로 재발급" })
      .click();
    const newLink = await mailLink(manager.context, email, oldLink);
    const page = await guest.newPage();
    await page.goto(oldLink);
    await expect(page.getByText(/초대 링크가 유효하지 않습니다/)).toBeVisible();
    const token = new URL(newLink).hash.slice(7);
    const withoutCsrf = await guest.request.post(
      `${baseURL}/api/invitations/preview`,
      { data: { token } },
    );
    expect(withoutCsrf.status()).toBe(403);
    expect((await withoutCsrf.json()).code).toBe("CSRF_INVALID");
    const acceptWithoutCsrf = await guest.request.post(
      `${baseURL}/api/invitations/accept`,
      {
        data: { mode: "NEW_ACCOUNT", email, password, token },
      },
    );
    expect(acceptWithoutCsrf.status()).toBe(403);
    expect((await acceptWithoutCsrf.json()).code).toBe("CSRF_INVALID");
    const container = process.env.INVITATION_LIVE_DB_CONTAINER;
    if (!container || !/^openstudy-invitation-live-[a-z0-9-]+$/.test(container))
      throw new Error(
        "Expiry verification requires the explicitly named disposable INVITATION_LIVE_DB_CONTAINER.",
      );
    if (!/^\d+$/.test(invitation.id))
      throw new Error("Unexpected invitation identifier");
    // The one time-based fixture change targets only the named disposable database.
    execFileSync("docker", [
      "exec",
      "--env",
      "MYSQL_PWD=invitation-local-only",
      container,
      "mysql",
      "-uroot",
      "invitation_live",
      "-e",
      `UPDATE employee_invitations SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=${invitation.id}`,
    ]);
    await page.goto(newLink);
    await expect(page.getByText(/초대 링크가 유효하지 않습니다/)).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/invitations/accept`);
  } finally {
    await guest.close();
    await manager.context.close();
  }
});

test("a rejected applicant sees the reason in a separate browser", async ({
  browser,
}) => {
  const manager = await owner(browser);
  const applicant = await browser.newContext({ baseURL });
  try {
    const suffix = randomUUID().slice(0, 8),
      email = `reject-${suffix}@invitation.test`,
      name = `반려 ${suffix}`;
    await create(manager.page, manager.branches[0].id, email, name);
    const page = await applicant.newPage();
    await acceptNew(page, await mailLink(manager.context, email));
    await login(page, email);
    await manager.page.reload();
    await manager.page
      .getByRole("button", { name: `초대 상세: ${name}`, exact: true })
      .click();
    await manager.page
      .getByLabel("반려 사유", { exact: true })
      .fill("근무 일정 재확인 필요");
    await manager.page
      .getByRole("button", { name: "초대 반려", exact: true })
      .click();
    await expect(
      manager.page.getByText(/거절 · 발송 완료 · 버전/),
    ).toBeVisible();
    await page.getByRole("button", { name: "승인 상태 새로고침" }).click();
    await expect(
      page.getByText("반려 사유: 근무 일정 재확인 필요"),
    ).toBeVisible();
    expect(
      (await applicant.request.get(`${baseURL}/api/lookups`)).status(),
    ).toBe(403);
  } finally {
    await applicant.close();
    await manager.context.close();
  }
});

test("a signed-in user can log out and continue the new-account mail link without storing the token", async ({
  browser,
}) => {
  const manager = await owner(browser);
  const recipient = await owner(browser);
  try {
    const suffix = randomUUID().slice(0, 8),
      email = `session-${suffix}@invitation.test`,
      name = `세션 ${suffix}`;
    await create(manager.page, manager.branches[0].id, email, name);
    const link = await mailLink(manager.context, email);
    const blocked = await command(recipient.context, "/invitations/accept", {
      mode: "NEW_ACCOUNT",
      email,
      password,
      token: new URL(link).hash.slice(7),
    });
    expect(blocked.status()).toBe(403);
    await recipient.page.goto(link);
    await recipient.page
      .getByRole("button", { name: "로그아웃하고 계속" })
      .click();
    await expect(recipient.page.getByLabel("새 계정 비밀번호")).toBeVisible();
    await recipient.page.getByLabel("새 계정 비밀번호").fill(password);
    await recipient.page
      .getByRole("button", { name: "초대 수락", exact: true })
      .click();
    await expect(
      recipient.page.getByRole("heading", { name: "초대 수락이 완료됐어요" }),
    ).toBeVisible();
    expect(
      (await recipient.context.request.get(`${baseURL}/api/me`)).status(),
    ).toBe(401);
  } finally {
    await recipient.context.close();
    await manager.context.close();
  }
});
