import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
async function api(page: Page, path: string, body?: object, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      const response = await fetch(
        `/api${path}`,
        body
          ? {
              method,
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf.token,
              },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      return { status: response.status, data: await response.json() };
    },
    { path, body, method },
  );
}
async function channel(page: Page, name: string) {
  const response = await api(page, "/channels", {
    branchId: "gangnam",
    name,
    description: "채팅 검증",
    participantIds: ["owner", "junho"],
  });
  expect(response.status).toBe(200);
  return response.data.id as string;
}
async function message(page: Page, id: string, text: string, parentId = "") {
  const response = await api(page, `/chat/${id}/messages`, {
    text,
    parentId,
    taskId: "",
    clientMessageId: crypto.randomUUID(),
  });
  expect(response.status).toBe(200);
  return response.data;
}
test("root reads leave unopened threads unread and each opened thread advances independently", async ({
  page,
}) => {
  await login(page);
  const id = await channel(page, "스레드 읽음 시험");
  const first = await message(page, id, "원문 A"),
    second = await message(page, id, "원문 B");
  await message(page, id, "A의 답글", first.id);
  await message(page, id, "B의 답글", second.id);
  await api(page, "/_demo", { persona: "junho" });
  await page.goto(`/app/gangnam/chat/${id}`);
  const unread = async () =>
    (await api(page, "/chat/channels?scope=gangnam")).data.find(
      (c: { id: string }) => c.id === id,
    )?.unread;
  await expect(page.locator(".chat-main article")).toHaveCount(2);
  await expect.poll(unread).toBe(2);
  await page
    .locator(".chat-main article")
    .filter({ hasText: "원문 A" })
    .getByRole("button", { name: "답글 달기" })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "스레드" })
      .getByText("A의 답글", { exact: true }),
  ).toBeVisible();
  await expect.poll(unread).toBe(1);
  await page
    .locator(".chat-main article")
    .filter({ hasText: "원문 B" })
    .getByRole("button", { name: "답글 달기" })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "스레드" })
      .getByText("B의 답글", { exact: true }),
  ).toBeVisible();
  await expect.poll(unread).toBe(0);
});
test("membership removal clears an open conversation and restoring membership does not restore its draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/chat/gangnam");
  await page
    .getByRole("textbox", { name: "메시지", exact: true })
    .fill("회수 전 초안");
  const original = (await api(page, "/channels/gangnam?scope=gangnam")).data;
  await api(
    page,
    "/channels/gangnam",
    {
      version: original.version,
      participantIds: original.participantIds.filter(
        (id: string) => id !== "owner",
      ),
    },
    "PATCH",
  );
  await expect(
    page.getByRole("heading", { name: "접근할 수 없는 대화예요" }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toHaveCount(0);
  expect((await api(page, "/chat/gangnam/messages?parent=")).status).toBe(403);
  const updated = (await api(page, "/channels/gangnam?scope=gangnam")).data;
  await api(
    page,
    "/channels/gangnam",
    { version: updated.version, participantIds: original.participantIds },
    "PATCH",
  );
  await page.getByRole("button", { name: "채팅 새로고침" }).click();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toHaveValue("");
});
test("failed messages and drafts survive ordinary navigation and reuse the original attempt", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/chat/gangnam");
  await api(page, "/_demo", { scenario: "message-failure" });
  const input = page.getByRole("textbox", { name: "메시지", exact: true });
  await input.fill("화면 이동 후 재전송");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "재전송", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "내 프로필·테마" })
    .count()
    .then(async (count) => {
      if (count)
        await page.getByRole("link", { name: "내 프로필·테마" }).click();
      else
        await page.locator('a[href="/app/gangnam/settings"]').first().click();
    });
  await page.locator('a[href="/app/gangnam/chat"]').first().click();
  await page.getByRole("link", { name: /강남점-운영/ }).click();
  await expect(input).toHaveValue("화면 이동 후 재전송");
  await expect(
    page.getByRole("button", { name: "재전송", exact: true }),
  ).toBeVisible();
  await api(page, "/_demo", { scenario: "normal" });
  await page.getByRole("button", { name: "재전송", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.locator("article p").filter({ hasText: "화면 이동 후 재전송" }),
  ).toHaveCount(1);
});
test("card access does not disclose stored task-title text to another branch", async ({
  page,
}) => {
  await login(page);
  await api(page, "/chat/general/messages", {
    text: "민감한 공유 문구: 스터디룸 A 냉방 상태 확인",
    parentId: "",
    taskId: "task-1",
    clientMessageId: "redacted-card",
  });
  await api(page, "/_demo", { persona: "doyun" });
  await page.goto("/app/seongsu/chat/general");
  await expect(page.getByText("접근 불가", { exact: true })).toBeVisible();
  await expect(page.getByText(/민감한 공유 문구/)).toHaveCount(0);
  await expect(
    page.getByText("스터디룸 A 냉방 상태 확인", { exact: true }),
  ).toHaveCount(0);
  const messages = (await api(page, "/chat/general/messages?parent=")).data
    .items;
  expect(
    messages.find(
      (m: { clientMessageId: string }) => m.clientMessageId === "redacted-card",
    ).text,
  ).toBe("업무를 공유했어요.");
});
test("older pages and a multi-page burst retain loaded history without duplicates", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  const id = await channel(page, "페이지 경계 시험");
  await page.evaluate(async (id) => {
    const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
    await Promise.all(
      Array.from({ length: 70 }, (_, i) =>
        fetch(`/api/chat/${id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf.token,
          },
          body: JSON.stringify({
            text: `초기-${i}`,
            parentId: "",
            taskId: "",
            clientMessageId: `initial-${i}`,
          }),
        }),
      ),
    );
  }, id);
  await page.goto(`/app/gangnam/chat/${id}`);
  await expect(page.locator(".chat-main article[data-message-id]")).toHaveCount(
    30,
  );
  await page.getByRole("button", { name: "이전 메시지 불러오기" }).click();
  await expect(page.locator(".chat-main article[data-message-id]")).toHaveCount(
    60,
  );
  const oldIds = await page
    .locator(".chat-main article[data-message-id]")
    .evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("data-message-id")),
    );
  await page.locator(".chat-main .messages").evaluate((element) => {
    element.scrollTop = 10;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(async (id) => {
    const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
    await Promise.all(
      Array.from({ length: 65 }, (_, i) =>
        fetch(`/api/chat/${id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf.token,
          },
          body: JSON.stringify({
            text: `추가-${i}`,
            parentId: "",
            taskId: "",
            clientMessageId: `burst-${i}`,
          }),
        }),
      ),
    );
  }, id);
  await page.getByRole("button", { name: "채팅 새로고침" }).click();
  await expect(page.locator(".chat-main article[data-message-id]")).toHaveCount(
    125,
  );
  const ids = await page
    .locator(".chat-main article[data-message-id]")
    .evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("data-message-id")),
    );
  expect(new Set(ids).size).toBe(125);
  expect(oldIds.every((id) => ids.includes(id))).toBe(true);
  await expect(
    page.getByRole("button", { name: "새 메시지로 이동" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 메시지로 이동" }).click();
  await expect
    .poll(() =>
      page
        .locator(".chat-main .messages")
        .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight),
    )
    .toBeLessThan(3);
});
test("a task viewer can select a channel and share without gaining edit rights", async ({
  page,
}) => {
  await login(page);
  await api(page, "/_demo", { persona: "junho" });
  await page.goto("/app/gangnam/tasks?detail=task-1");
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("button", { name: "수정하기" })).toHaveCount(0);
  await panel
    .getByRole("button", { name: "운영 채널에 공유", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "운영 채널에 공유", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("공유할 채널").selectOption("gangnam");
  await panel
    .getByRole("button", { name: "운영 채널에 공유", exact: true })
    .click();
  await expect(panel.getByText("체크리스트", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "수정하기" })).toHaveCount(0);
  const messages = (await api(page, "/chat/gangnam/messages?parent=")).data
    .items;
  expect(
    messages.some(
      (m: { authorId: string; taskId: string }) =>
        m.authorId === "junho" && m.taskId === "task-1",
    ),
  ).toBe(true);
});
