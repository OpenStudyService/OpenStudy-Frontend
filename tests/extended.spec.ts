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
  await expect(
    page.getByRole("tab", { name: "휴가 부여", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("시작일", { exact: true }).fill("2026-10-20");
  await page.getByLabel("종료일", { exact: true }).fill("2026-10-20");
  await page.getByLabel("신청 일수").fill("1.5");
  await expect(page.getByRole("alert")).toContainText(
    "기간의 달력 일수(1일)를 넘을 수 없습니다",
  );
  await page.getByLabel("신청 일수").fill("1");
  await page.getByLabel("사유", { exact: true }).fill("개인 일정");
  await page
    .getByRole("button", { name: "휴가 신청 등록", exact: true })
    .click();
  await expect(page.getByText("휴가 신청을 접수했습니다.")).toBeVisible();
  const staffCard = page.getByRole("article").filter({ hasText: "개인 일정" });
  await expect(
    staffCard.getByRole("button", { name: "승인", exact: true }),
  ).toHaveCount(0);
  await demo(page, { persona: "owner" });
  await page.goto("/app/gangnam/attendance?tab=leaveRequests");
  const card = page.getByRole("article").filter({ hasText: "개인 일정" });
  const balance = page.getByRole("region", { name: "휴가 잔여량" });
  await balance.getByLabel("잔여량 조회 대상").selectOption("junho");
  await card.getByRole("button", { name: "승인", exact: true }).click();
  await expect(card).toContainText("승인 ·");
  await expect(balance.getByText("박준호 · 잔여 14일")).toBeVisible();
  await balance.getByRole("button", { name: "부여·사용·복원 내역" }).click();
  await expect(balance).toContainText("사용 · -1일");
  await expect(balance).toContainText("내역 합계 14일");
  await page.goto("/app/gangnam/attendance?tab=shifts&week=2026-10-20");
  await expect(
    page.getByText("휴가 · 1일 승인", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "휴가 신청·승인" }).click();
  await balance.getByLabel("잔여량 조회 대상").selectOption("junho");
  await card.getByRole("button", { name: "승인 취소", exact: true }).click();
  await expect(card).toContainText("취소 ·");
  await expect(balance.getByText("박준호 · 잔여 15일")).toBeVisible();
  await balance.getByRole("button", { name: "부여·사용·복원 내역" }).click();
  await expect(balance).toContainText("복원 · +1일");
  await expect(balance).toContainText("내역 합계 15일");
});

test("an expired session returns to login", async ({ page }) => {
  await login(page);
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
