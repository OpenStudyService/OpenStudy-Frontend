import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
const password = process.env.CHAT_LIVE_PASSWORD;
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare isolated Backend and CHAT_LIVE_PASSWORD per docs/testing/chat-live.md",
    );
});
async function login(browser: Browser, email = "owner@chat.test") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15185",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { context, page };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    data: body,
    headers: { "X-CSRF-Token": token, "Idempotency-Key": randomUUID() },
  });
}
async function channel(context: BrowserContext, members = ["2"]) {
  const response = await api(context, "/channels?scope=1", {
    kind: "지점",
    branchId: "1",
    name: `Live ${randomUUID().slice(0, 8)}`,
    description: "실제 연동 검증",
    memberIds: members,
  });
  expect(response.status()).toBe(201);
  return response.json();
}
test("channel creation keeps its idempotency key after a committed response is lost", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const name = `생성 재시도 ${randomUUID().slice(0, 8)}`;
    const sent: { key: string | undefined; body: unknown }[] = [];
    await owner.page.goto("/app/1/settings?tab=channels&detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("채널 이름", { exact: true }).fill(name);
    await owner.page.route("**/api/channels", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sent.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (sent.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "채널 등록", exact: true }).click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await expect(panel.getByLabel("채널 이름", { exact: true })).toHaveValue(
      name,
    );
    await panel.getByRole("button", { name: "채널 등록", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const channels = await (
      await api(owner.context, "/channels?scope=1")
    ).json();
    expect(
      channels.items.filter((c: { name: string }) => c.name === name),
    ).toHaveLength(1);
  } finally {
    await owner.context.close();
  }
});
test("old task cards refresh current source and inaccessible participants see no task content", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@chat.test"),
    other = await login(browser, "cashier@chat.test");
  try {
    const suffix = randomUUID().slice(0, 8),
      title = `공유 원본 ${suffix}`;
    const taskResponse = await api(owner.context, "/tasks?scope=1", {
      branchId: "1",
      title,
      body: "업무 카드 실제 검증",
      assigneeId: "2",
      category: "운영",
      priority: "보통",
      dueAt: "2030-01-01T00:00:00Z",
      checklist: [],
    });
    expect(taskResponse.status()).toBe(201);
    const task = await taskResponse.json();
    const channelResponse = await api(owner.context, "/channels", {
      kind: "전체",
      name: `공유 채널 ${suffix}`,
      memberIds: ["2", "3"],
    });
    expect(channelResponse.status()).toBe(201);
    const c = await channelResponse.json();
    const shared = await api(owner.context, `/channels/${c.id}/task-cards`, {
      clientMessageKey: randomUUID(),
      taskId: task.id,
      text: "업무를 공유했어요.",
    });
    expect(shared.status()).toBe(201);
    for (let i = 0; i < 51; i++)
      expect(
        (
          await api(owner.context, `/channels/${c.id}/messages`, {
            clientMessageKey: randomUUID(),
            text: `카드 이후 ${i}`,
          })
        ).status(),
      ).toBe(201);
    await staff.page.goto(`/app/1/chat/${c.id}`);
    await expect(
      staff.page.getByText("카드 이후 50", { exact: true }),
    ).toBeVisible();
    await staff.page
      .getByRole("button", { name: /이전 메시지|과거 메시지/ })
      .first()
      .click();
    await expect(staff.page.getByText(title, { exact: true })).toBeVisible();
    const current = await (
      await api(owner.context, `/tasks/${task.id}?scope=1`)
    ).json();
    expect(
      (
        await api(owner.context, `/tasks/${task.id}/status?scope=1`, {
          version: current.version,
          status: "완료",
        })
      ).status(),
    ).toBe(200);
    await staff.page.getByRole("button", { name: "채팅 새로고침" }).click();
    const card = staff.page.locator(".task-card").filter({ hasText: title });
    await expect(card.getByText("완료", { exact: true })).toBeVisible();
    await card.click();
    await expect(staff.page.getByRole("dialog")).toBeVisible();
    await other.page.goto(`/app/2/chat/${c.id}`);
    await expect(
      other.page.getByText("카드 이후 50", { exact: true }),
    ).toBeVisible();
    await other.page
      .getByRole("button", { name: /이전 메시지|과거 메시지/ })
      .first()
      .click();
    await expect(
      other.page.getByText("접근 불가", { exact: true }),
    ).toBeVisible();
    await expect(other.page.getByText(title, { exact: true })).toHaveCount(0);
    await other.page.screenshot({
      path: "qa-artifacts/chat-live/card-denied-desktop.png",
      fullPage: true,
    });
    await staff.page.setViewportSize({ width: 390, height: 844 });
    await staff.page.screenshot({
      path: "qa-artifacts/chat-live/task-detail-mobile.png",
      fullPage: true,
    });
  } finally {
    await owner.context.close();
    await staff.context.close();
    await other.context.close();
  }
});

test("actual channel management preserves edits through conflict and saves metadata and participants", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const c = await channel(owner.context),
      name = `갱신 ${randomUUID().slice(0, 8)}`;
    await owner.page.goto(`/app/1/settings?tab=channels&detail=${c.id}`);
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("채널 이름", { exact: true }).fill(name);
    const current = await (
      await api(owner.context, `/channels/${c.id}`)
    ).json();
    expect(
      (
        await api(
          owner.context,
          `/channels/${c.id}`,
          { version: current.version, description: "동시 수정 설명" },
          "PATCH",
        )
      ).status(),
    ).toBe(200);
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByLabel("채널 이름", { exact: true })).toHaveValue(
      name,
    );
    await panel.getByRole("button", { name: /최신 채널|최신 내용/ }).click();
    await panel
      .getByRole("button", { name: "최신 기준으로 다시 저장", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    const result = await (await api(owner.context, `/channels/${c.id}`)).json();
    expect(result.name).toBe(name);
    expect(result.description).toBe("동시 수정 설명");
    await owner.page.goto(`/app/1/settings?tab=channels&detail=${c.id}`);
    await panel
      .getByLabel("채널 설명", { exact: true })
      .fill("설명과 참여자 변경");
    await panel.getByLabel("참여 직원", { exact: true }).selectOption(["1"]);
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    const members = await (
      await api(owner.context, `/channels/${c.id}/members`)
    ).json();
    expect(
      members.items.map((m: { employee: { id: string } }) => m.employee.id),
    ).toEqual(["1"]);
    await owner.page.reload();
    await expect(owner.page.getByText(name, { exact: true })).toBeVisible();
  } finally {
    await owner.context.close();
  }
});
test("actual text/thread pagination, response loss replay and participation termination", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@chat.test");
  try {
    const c = await channel(owner.context);
    const noReads: string[] = [];
    staff.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/read"))
        noReads.push(r.url());
    });
    const html = "<script>window.chatXss=true</script>";
    const first = await (
      await api(owner.context, `/channels/${c.id}/messages`, {
        clientMessageKey: randomUUID(),
        text: html,
        parentId: null,
      })
    ).json();
    for (let i = 0; i < 52; i++)
      expect(
        (
          await api(owner.context, `/channels/${c.id}/messages`, {
            clientMessageKey: randomUUID(),
            text: `과거 ${i}`,
            parentId: null,
          })
        ).status(),
      ).toBe(201);
    await staff.page.goto(`/app/1/chat/${c.id}`);
    await expect(
      staff.page.getByText("과거 51", { exact: true }),
    ).toBeVisible();
    await staff.page
      .getByRole("button", { name: /이전 메시지|과거 메시지/ })
      .first()
      .click();
    await expect(staff.page.getByText(html, { exact: true })).toBeVisible();
    expect(await staff.page.evaluate(() => "chatXss" in window)).toBe(false);
    const root = staff.page
      .locator(".chat-main article")
      .filter({ hasText: html });
    await root.getByRole("button", { name: "답글 달기" }).click();
    const thread = staff.page.getByRole("complementary", {
      name: "스레드",
      exact: true,
    });
    await thread
      .getByRole("textbox", { name: "스레드 답글" })
      .fill("실제 답글");
    await thread.getByRole("button", { name: /보내기/ }).click();
    await expect(
      thread.locator("article").getByText("실제 답글", { exact: true }),
    ).toBeVisible();
    await expect(
      thread.getByRole("textbox", { name: "스레드 답글" }),
    ).toHaveValue("");
    expect(
      (
        await (
          await api(
            owner.context,
            `/channels/${c.id}/messages/${first.id}/replies`,
          )
        ).json()
      ).items,
    ).toHaveLength(1);
    const sent: { key: string; text: string }[] = [];
    await staff.page.route(
      `**/api/channels/${c.id}/messages`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON();
        sent.push({ key: body.clientMessageKey, text: body.text });
        const response = await route.fetch();
        expect([200, 201]).toContain(response.status());
        if (sent.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await staff.page
      .getByRole("textbox", { name: "메시지", exact: true })
      .fill("응답 유실 텍스트");
    await staff.page
      .locator(".chat-main")
      .getByRole("button", { name: /보내기/ })
      .click();
    await staff.page
      .getByRole("button", { name: /재전송|다시 보내기/ })
      .first()
      .click();
    await expect(
      staff.page
        .locator(".chat-main article")
        .getByText("응답 유실 텍스트", { exact: true }),
    ).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(noReads).toHaveLength(0);
    const current = await (
      await api(owner.context, `/channels/${c.id}`)
    ).json();
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
    await staff.page.getByRole("button", { name: "채팅 새로고침" }).click();
    await expect(
      staff.page.getByRole("textbox", { name: "메시지", exact: true }),
    ).toHaveCount(0);
    expect(
      (await api(staff.context, `/channels/${c.id}/messages`)).status(),
    ).toBe(404);
    await staff.page.reload();
    await expect(staff.page.getByText(html, { exact: true })).toHaveCount(0);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
