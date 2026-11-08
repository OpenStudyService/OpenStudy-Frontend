import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

test.skip(
  true,
  "팀 채팅 화면과 백엔드 기본 라우트가 비활성화되었습니다 (#70).",
);

const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();
async function login(
  browser: Browser,
  email = "owner@chat.test",
  label = "primary",
) {
  const key = `${email}:${label}`,
    state = sessions.get(key);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15194",
    serviceWorkers: "block",
    storageState: state,
  });
  if (!state) {
    const csrf = await (await context.request.get("/api/auth/csrf")).json();
    const response = await context.request.post("/api/auth/login", {
      data: { email, password: process.env.CHAT_LIVE_PASSWORD },
      headers: { "X-CSRF-Token": csrf.token },
    });
    expect(response.status(), await response.text()).toBe(200);
    sessions.set(key, await context.storageState());
  }
  return { context, page: await context.newPage() };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
) {
  if (!body) return context.request.get(`/api${path}`);
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    data: body,
    headers: {
      "X-CSRF-Token": csrf.token,
      ...(path.endsWith("/read") ? {} : { "Idempotency-Key": randomUUID() }),
    },
  });
}
async function create(context: BrowserContext) {
  const response = await api(context, "/channels", {
    kind: "지점",
    branchId: "1",
    name: `독립 읽음 ${randomUUID().slice(0, 8)}`,
    memberIds: ["1", "2"],
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function send(
  context: BrowserContext,
  channel: string,
  text: string,
  parentId?: string,
) {
  const response = await api(context, `/channels/${channel}/messages`, {
    text,
    clientMessageKey: randomUUID(),
    ...(parentId ? { parentId } : {}),
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
const counts = async (context: BrowserContext, id: string) => {
  const value = await (await api(context, `/channels/${id}`)).json();
  return [value.mainUnreadCount, value.replyUnreadCount, value.unreadCount];
};
const threadState = async (
  context: BrowserContext,
  id: string,
  parent: string,
) => (await api(context, `/channels/${id}/messages/${parent}`)).json();

test("two actual browser sessions keep root and two threads independent, including a hidden mobile main pane", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@chat.test");
  try {
    const c = await create(owner.context);
    const a = await send(owner.context, c.id, "원문 A"),
      ar = await send(owner.context, c.id, "A 답글", a.id);
    const b = await send(owner.context, c.id, "원문 B");
    await send(owner.context, c.id, "B 답글", b.id);
    const last = await send(owner.context, c.id, "더 늦은 원문 C");
    expect(await counts(staff.context, c.id)).toEqual([3, 2, 5]);
    const posted: { path: string; body: unknown; key?: string }[] = [];
    staff.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/read"))
        posted.push({
          path: new URL(r.url()).pathname,
          body: r.postDataJSON(),
          key: r.headers()["idempotency-key"],
        });
    });
    await staff.page.goto(`/app/1/chat/${c.id}`);
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 2, 2]);
    await expect(
      staff.page
        .getByRole("status", { includeHidden: true })
        .filter({ hasText: "미확인 본문 0개 · 답글 2개" }),
    ).toBeVisible();
    await expect(
      staff.page
        .locator(`a[href="/app/1/chat/${c.id}"]`)
        .getByLabel("미확인 2개", { exact: true }),
    ).toBeVisible();
    const rootA = staff.page.locator(
      `.chat-main article[data-message-id="${a.id}"]`,
    );
    await expect(rootA.getByRole("button")).toContainText("미확인 1");
    await rootA.getByRole("button").click();
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 1, 1]);
    await expect
      .poll(
        async () =>
          (await threadState(staff.context, c.id, a.id))
            .threadLastReadMessageId,
      )
      .toBe(ar.id);
    await expect(rootA.getByRole("button")).not.toContainText("미확인");
    await staff.page.setViewportSize({ width: 390, height: 844 });
    const newRoot = await send(
      owner.context,
      c.id,
      "모바일에서 가려진 새 본문",
    );
    await send(owner.context, c.id, "열지 않은 B 새 답글", b.id);
    await staff.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      staff.page
        .getByRole("status", { includeHidden: true })
        .filter({ hasText: "미확인 본문 1개 · 답글 2개" }),
    ).toHaveCount(1);
    expect(await counts(staff.context, c.id)).toEqual([1, 2, 3]);
    await staff.page.getByRole("button", { name: "스레드 닫기" }).click();
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 2, 2]);
    await staff.page
      .locator(`.chat-main article[data-message-id="${b.id}"]`)
      .getByRole("button")
      .click();
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 0, 0]);
    await staff.page.screenshot({
      path: "qa-artifacts/chat-read-live/thread-mobile.png",
      fullPage: true,
    });
    expect(posted).toContainEqual({
      path: `/api/channels/${c.id}/read`,
      body: { messageId: last.id },
      key: undefined,
    });
    expect(posted).toContainEqual({
      path: `/api/channels/${c.id}/read`,
      body: { messageId: newRoot.id },
      key: undefined,
    });
    expect(posted).toContainEqual({
      path: `/api/channels/${c.id}/messages/${a.id}/read`,
      body: { replyId: ar.id },
      key: undefined,
    });
    await send(staff.context, c.id, "직원이 직접 보낸 원문");
    expect(await counts(owner.context, c.id)).toEqual([1, 0, 1]);
    expect(await counts(staff.context, c.id)).toEqual([0, 0, 0]);
    await staff.page.reload();
    await expect(
      staff.page.getByRole("textbox", { name: "스레드 답글" }),
    ).toBeVisible();
    expect(await counts(staff.context, c.id)).toEqual([0, 0, 0]);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});

test("actual committed read response loss retries the same target and scrolling above new content does not mark it read", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@chat.test");
  try {
    const c = await create(owner.context),
      first = await send(owner.context, c.id, "처음 본문");
    const posts: unknown[] = [];
    await staff.page.route(`**/api/channels/${c.id}/read`, async (route) => {
      posts.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (posts.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await staff.page.goto(`/app/1/chat/${c.id}`);
    await expect(
      staff.page.getByText("읽음 상태를 저장하지 못했어요."),
    ).toBeVisible();
    expect(await counts(staff.context, c.id)).toEqual([0, 0, 0]);
    await staff.page.getByRole("button", { name: "읽음 다시 시도" }).click();
    await expect(
      staff.page.getByText("읽음 상태를 저장하지 못했어요."),
    ).toHaveCount(0);
    expect(posts.slice(0, 2)).toEqual([
      { messageId: first.id },
      { messageId: first.id },
    ]);
    // First establish a tall feed, then deliberately leave its bottom before new messages arrive.
    for (let i = 0; i < 12; i++)
      await send(
        owner.context,
        c.id,
        `긴 본문 ${i}\n${"스크롤 확인 ".repeat(100)}`,
      );
    await staff.page.getByRole("button", { name: "채팅 새로고침" }).click();
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 0, 0]);
    const pane = staff.page.locator(".chat-main .messages");
    await pane.evaluate((e) => {
      e.scrollTop = 0;
      e.dispatchEvent(new Event("scroll"));
    });
    const before = posts.length;
    await send(owner.context, c.id, "하단 확인 전까지 미확인");
    await staff.page.getByRole("button", { name: "채팅 새로고침" }).click();
    await expect(staff.page.locator(".chat-main article")).toHaveCount(14);
    expect(await counts(staff.context, c.id)).toEqual([1, 0, 1]);
    expect(posts).toHaveLength(before);
    await staff.page.getByRole("button", { name: "새 메시지로 이동" }).click();
    await expect.poll(() => counts(staff.context, c.id)).toEqual([0, 0, 0]);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});

test("actual concurrent sessions cannot regress reads; invalid targets and ended participation are rejected; rejoin resets the baseline", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@chat.test"),
    second = await login(browser, "staff@chat.test", "second");
  try {
    const c = await create(owner.context),
      a = await send(owner.context, c.id, "A"),
      ar = await send(owner.context, c.id, "A1", a.id),
      ar2 = await send(owner.context, c.id, "A2", a.id);
    const b = await send(owner.context, c.id, "B"),
      br = await send(owner.context, c.id, "B1", b.id);
    expect(
      (
        await api(staff.context, `/channels/${c.id}/read`, { messageId: ar.id })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api(staff.context, `/channels/${c.id}/messages/${a.id}/read`, {
          replyId: br.id,
        })
      ).status(),
    ).toBe(422);
    const path = `/channels/${c.id}/messages/${a.id}/read`;
    const updates = await Promise.all([
      api(staff.context, path, { replyId: ar.id }),
      api(second.context, path, { replyId: ar2.id }),
      api(staff.context, path, { replyId: ar2.id }),
    ]);
    expect(updates.map((r) => r.status())).toEqual([200, 200, 200]);
    await api(staff.context, path, { replyId: ar.id });
    expect(
      (await threadState(staff.context, c.id, a.id)).threadLastReadMessageId,
    ).toBe(ar2.id);
    expect(await counts(staff.context, c.id)).toEqual([2, 1, 3]);
    let current = await (await api(owner.context, `/channels/${c.id}`)).json();
    expect(
      (
        await api(
          owner.context,
          `/channels/${c.id}/members`,
          { version: current.version, employeeIds: ["1"] },
          "PUT",
        )
      ).status(),
    ).toBe(200);
    expect((await api(staff.context, path, { replyId: ar2.id })).status()).toBe(
      404,
    );
    expect(
      (
        await api(staff.context, `/channels/${c.id}/read`, { messageId: b.id })
      ).status(),
    ).toBe(404);
    current = await (await api(owner.context, `/channels/${c.id}`)).json();
    expect(
      (
        await api(
          owner.context,
          `/channels/${c.id}/members`,
          { version: current.version, employeeIds: ["1", "2"] },
          "PUT",
        )
      ).status(),
    ).toBe(200);
    expect(await counts(staff.context, c.id)).toEqual([0, 0, 0]);
    const baseline = await (
      await api(staff.context, `/channels/${c.id}`)
    ).json();
    expect(baseline.lastReadMessageId).toBe(br.id); // This is a reply ID; never fetch it as a root.
    await staff.page.goto(`/app/1/chat/${c.id}`);
    await expect(staff.page.locator(".chat-main article")).toHaveCount(2);
    await expect(
      staff.page.getByText("읽음 상태를 저장하지 못했어요."),
    ).toHaveCount(0);
    expect(
      (await (await api(staff.context, `/channels/${c.id}`)).json())
        .lastReadMessageId,
    ).toBe(br.id);
    await send(owner.context, c.id, "재참여 뒤 새 답글", a.id);
    expect(await counts(staff.context, c.id)).toEqual([0, 1, 1]);
  } finally {
    await owner.context.close();
    await staff.context.close();
    await second.context.close();
  }
});
