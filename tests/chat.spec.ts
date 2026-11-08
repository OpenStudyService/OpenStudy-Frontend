import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page, role = "사장님") {
  await page.goto("/login");
  await page.getByRole("button", { name: role + "으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}

test("the rail and home open AI chat, legacy links replace in scope, and channels stay inactive", async ({
  page,
}) => {
  const channelRequests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/(?:channels|chat)(?:\/|$)/.test(pathname))
      channelRequests.push(pathname);
  });
  await login(page);
  await page.goto("/app/gangnam/home");
  const rail = page.getByRole("navigation", { name: "빠른 탐색", exact: true });
  const question = page.getByRole("textbox", { name: "AI에게 질문" });
  await expect(page.getByRole("heading", { name: "AI 채팅" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "업무 AI", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("link", { name: "채팅", exact: true }).click();
  await expect(question).toBeVisible();
  await expect(page).toHaveURL(/\/app\/gangnam\/chat$/);
  await expect(page.getByRole("heading", { name: "팀 채팅" })).toHaveCount(0);
  await page.goBack();
  await page.getByRole("link", { name: "AI 채팅 열기" }).click();
  await expect(question).toBeVisible();

  for (const legacy of ["ai", "chat/123"]) {
    await page.goto("/app/gangnam/home");
    await page.goto("/app/gangnam/" + legacy);
    await expect(question).toBeVisible();
    await expect(page).toHaveURL(/\/app\/gangnam\/chat$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/gangnam\/home$/);
  }

  await page.goto("/app/gangnam/settings?tab=channels");
  await expect(
    page.getByRole("heading", { name: "공간·운영 환경" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "채널 관리" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "채널 등록" })).toHaveCount(0);

  await page.goto("/app/gangnam/tasks");
  await page
    .getByRole("table")
    .getByRole("row")
    .nth(1)
    .getByRole("button")
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "수정하기" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "운영 채널에 공유" }),
  ).toHaveCount(0);
  await page.goto(page.url() + "&action=share");
  await expect(dialog.getByText("이 작업을 수행할 수 없어요.")).toBeVisible();
  await expect(dialog.getByLabel("공유할 채널")).toHaveCount(0);

  await page.goto("/app/gangnam/home");
  await page.getByRole("button", { name: "사용자 메뉴" }).first().click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(channelRequests).toEqual([]);
});

test("staff without AI read permission cannot open AI chat", async ({
  page,
}) => {
  await login(page, "직원");
  await expect(
    page.getByRole("link", { name: "채팅", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "AI 채팅 열기" })).toHaveCount(0);
  await page.goto("/app/gangnam/chat");
  await expect(
    page.getByRole("heading", { name: "AI 조회 권한이 필요해요" }),
  ).toBeVisible();
});

test("demo returns 404 for disabled channel operations", async ({ page }) => {
  await login(page);
  const statuses = await page.evaluate(async () => {
    const paths = [
      "/api/channels",
      "/api/channels/123/messages",
      "/api/channels/123/read",
      "/api/chat/channels",
    ];
    return Promise.all(paths.map(async (path) => (await fetch(path)).status));
  });
  expect(statuses).toEqual([404, 404, 404, 404]);
});
