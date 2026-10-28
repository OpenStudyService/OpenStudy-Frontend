import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function login(page: Page, role = "사장님") {
  await page.goto("/login");
  await page.getByRole("button", { name: `${role}으로 체험` }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
async function demo(page: Page, data: Record<string, unknown>) {
  await page.evaluate(async (body) => {
    const { token } = await fetch("/api/auth/csrf").then((r) => r.json());
    const response = await fetch("/api/_demo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(await response.text());
  }, data);
}

test("leave approval/cancel and weekly schedule use one balance", async ({
  page,
}) => {
  await login(page, "직원");
  await page.goto("/app/gangnam/attendance?tab=leaveRequests");
  await page
    .getByRole("button", { name: "휴가 신청 등록", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("시작일", { exact: true }).fill("2026-10-20");
  await dialog.getByLabel("종료일", { exact: true }).fill("2026-10-20");
  await dialog.getByLabel("신청 일수").fill("1");
  await dialog.getByLabel("사유", { exact: true }).fill("개인 일정");
  await dialog
    .getByRole("button", { name: "휴가 신청 등록", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await demo(page, { persona: "owner" });
  await page.goto("/app/gangnam/attendance?tab=leaveRequests");
  await page.getByRole("button", { name: "박준호", exact: true }).click();
  await dialog.getByRole("button", { name: "승인", exact: true }).click();
  await dialog.getByRole("button", { name: "승인", exact: true }).click();
  await expect(dialog.locator(".badge")).toHaveText("승인");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  const balance = await page.evaluate(() =>
    fetch("/api/leave-balances?scope=gangnam").then((r) => r.json()),
  );
  expect(
    balance.find((b: { employeeId: string }) => b.employeeId === "junho")
      .balance,
  ).toBe(14);
  await page.goto("/app/gangnam/attendance?tab=shifts&week=2026-10-20");
  await expect(
    page.getByText("휴가 · 1일 승인", { exact: true }),
  ).toBeVisible();
  await page.goto("/app/gangnam/attendance?tab=leaveRequests");
  await page.getByRole("button", { name: "박준호", exact: true }).click();
  await dialog.getByRole("button", { name: "취소·복원", exact: true }).click();
  await dialog.getByLabel("처리 사유").fill("일정 변경");
  await dialog.getByRole("button", { name: "취소·복원", exact: true }).click();
  await expect(dialog.locator(".badge")).toHaveText("취소");
  const restored = await page.evaluate(() =>
    fetch("/api/leave-balances?scope=gangnam").then((r) => r.json()),
  );
  expect(
    restored.find((b: { employeeId: string }) => b.employeeId === "junho")
      .balance,
  ).toBe(15);
});

test("message IME, failed retry, duplicate removal and SSE reconnect", async ({
  page,
}) => {
  await login(page, "직원");
  await page.goto("/app/gangnam/chat/gangnam");
  const input = page.getByRole("textbox", { name: "메시지", exact: true });
  await input.fill("한글 조합 중");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  await expect(input).toHaveValue("한글 조합 중");
  await expect(
    page.locator("article p").filter({ hasText: "한글 조합 중" }),
  ).toHaveCount(0);
  await demo(page, { scenario: "message-failure" });
  await input.fill("재전송 시험 메시지");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "재전송", exact: true }),
  ).toBeVisible();
  await demo(page, { scenario: "normal" });
  await page.getByRole("button", { name: "재전송", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.locator("article p").filter({ hasText: "재전송 시험 메시지" }),
  ).toHaveCount(1);
  await demo(page, { scenario: "disconnect" });
  await expect(
    page.getByRole("status").filter({ hasText: "재연결 중" }),
  ).toBeVisible();
  await demo(page, { scenario: "normal" });
  await expect(
    page.getByRole("status").filter({ hasText: "연결됨" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator("article p").filter({ hasText: "재전송 시험 메시지" }),
  ).toHaveCount(1);
});

test("channel participants and session expiration", async ({ page }) => {
  await login(page);
  await page.goto("/app/gangnam/settings?tab=channels");
  await page.getByRole("button", { name: "채널 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("채널 이름").fill("교대 인수인계");
  await dialog.getByLabel("채널 설명").fill("교대 내용을 남겨 주세요");
  await dialog
    .getByLabel("참여 직원")
    .selectOption([{ label: "박준호" }, { label: "이민지" }]);
  await dialog.getByRole("button", { name: "채널 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/app/gangnam/chat");
  await expect(page.getByRole("link", { name: /교대 인수인계/ })).toHaveCount(
    0,
  );
  await demo(page, { persona: "junho" });
  await page.goto("/app/gangnam/chat");
  await expect(page.getByRole("link", { name: /교대 인수인계/ })).toBeVisible();
  await demo(page, { expire: true });
  await page.goto("/app/gangnam/home");
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
});

test("branch switch discards late results and restores URL filters", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/tasks");
  await expect(
    page.getByRole("button", {
      name: "스터디룸 A 냉방 상태 확인",
      exact: true,
    }),
  ).toBeVisible();
  await demo(page, { scenario: "slow" });
  await page
    .getByRole("combobox", { name: "현재 지점", exact: true })
    .selectOption("seongsu");
  await expect(
    page.getByRole("cell", { name: "성수점", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "강남점", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "스터디룸 A 냉방 상태 확인",
      exact: true,
    }),
  ).toHaveCount(0);
  await demo(page, { scenario: "normal" });
  await page.getByRole("searchbox", { name: "업무 검색" }).fill("없는 업무");
  await expect(
    page.getByRole("heading", { name: "등록된 항목이 없어요" }),
  ).toBeVisible();
  await expect(page.getByText("총 0건 · 1페이지")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "업무 검색" })).toHaveValue(
    "없는 업무",
  );
  await expect(
    page.getByRole("heading", { name: "등록된 항목이 없어요" }),
  ).toBeVisible();
  await expect(page.getByText("총 0건 · 1페이지")).toBeVisible();
});

test("AI clarification, unsupported request, empty data, failure and safe view fallback", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.goto("/app/all/ai");
  const question = page.getByLabel("어떤 데이터가 궁금하신가요?");
  const ask = async (text: string) => {
    await question.fill(text);
    await page.getByRole("button", { name: "질문하기", exact: true }).click();
  };
  await ask("운영 현황");
  await expect(
    page.getByText("확인이 필요해요", { exact: true }),
  ).toBeVisible();
  await ask("이번달 매출");
  await expect(
    page.getByText("지원하지 않는 질문", { exact: true }),
  ).toBeVisible();
  await demo(page, { scenario: "empty" });
  await ask("지난달 지점별 매출을 보여줘");
  await expect(
    page.getByText("조회된 데이터가 없어요", { exact: true }),
  ).toBeVisible();
  await demo(page, { scenario: "ai-failure" });
  await ask("지난달 지점별 매출을 보여줘");
  await expect(page.getByText("조회 실패", { exact: true })).toBeVisible();
  await demo(page, { scenario: "ai-view-fallback" });
  await ask("지난달 지점별 매출을 보여줘");
  await expect(
    page.getByText("지원하지 않는 결과 화면입니다", { exact: true }),
  ).toBeVisible();
});
