import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
async function login(page: Page, role = "사장님") {
  await page.goto("/login");
  await page.getByRole("button", { name: `${role}으로 체험` }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
async function mock(page: Page, body: Record<string, unknown>) {
  await page.evaluate(async (body) => {
    const csrf = (await fetch("/api/auth/csrf").then((r) => r.json())) as {
      token: string;
    };
    const r = await fetch("/api/_demo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.token,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
  }, body);
}
async function switchUser(page: Page, id: string) {
  await mock(page, { persona: id });
  await page.goto(`/app/${id === "owner" ? "all" : "gangnam"}/home`);
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
test("task -> shared card -> staff report -> completion persists everywhere", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/tasks");
  await page.getByRole("button", { name: "업무 등록", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("업무 제목").fill("스터디룸 냉방 점검 E2E");
  await panel
    .getByLabel("내용", { exact: true })
    .fill("냉방 온도와 필터를 확인해 주세요.");
  await panel
    .getByLabel("담당자", { exact: true })
    .selectOption({ label: "박준호" });
  await panel.getByLabel("기한").fill("2026-10-17");
  await panel.getByLabel("체크리스트").fill("필터 상태 확인\n온도 확인");
  await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page
    .getByRole("button", { name: "스터디룸 냉방 점검 E2E", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "운영 채널에 공유", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "운영 채널에 공유", exact: true })
    .click();
  await expect(panel.getByRole("button", { name: "수정하기" })).toBeVisible();
  await switchUser(page, "junho");
  await page.goto("/app/gangnam/chat/gangnam");
  const shared = page
    .locator("article")
    .filter({ hasText: "업무를 공유합니다: 스터디룸 냉방 점검 E2E" });
  await expect(shared).toBeVisible();
  await shared.getByRole("button", { name: "답글 달기" }).click();
  await page
    .getByRole("textbox", { name: "스레드 답글" })
    .fill("필터 청소 및 온도 확인 완료했습니다.");
  await page.getByRole("textbox", { name: "스레드 답글" }).press("Enter");
  await expect(
    page
      .locator("article p")
      .filter({ hasText: "필터 청소 및 온도 확인 완료했습니다." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "스레드 닫기" }).click();
  await expect(
    page.getByRole("complementary", { name: "스레드" }),
  ).not.toBeVisible();
  await shared.getByRole("button", { name: /연결된 업무/ }).click();
  await panel.getByRole("checkbox", { name: "필터 상태 확인" }).click();
  await expect(
    panel.getByRole("checkbox", { name: "필터 상태 확인" }),
  ).toBeChecked();
  await panel.getByRole("button", { name: "완료하기", exact: true }).click();
  await panel.getByRole("button", { name: "완료하기", exact: true }).click();
  await expect(panel.getByRole("button", { name: "다시 열기" })).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(shared.getByText("완료", { exact: true })).toBeVisible();
  await page.reload();
  await expect(shared.getByText("완료", { exact: true })).toBeVisible();
  await page.goto("/app/gangnam/tasks");
  await page
    .getByRole("searchbox", { name: "업무 검색" })
    .fill("스터디룸 냉방 점검 E2E");
  await expect(
    page.getByRole("row").filter({ hasText: "스터디룸 냉방 점검 E2E" }),
  ).toContainText("완료");
});
test("purchase/refund and room booking conflicts preserve input", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/payments");
  await page.getByRole("button", { name: "결제 등록", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel
    .getByLabel("회원", { exact: true })
    .selectOption({ label: "한유나" });
  await panel
    .getByLabel("구매 상품")
    .selectOption({ label: "루틴 기간권 4주" });
  await panel.getByRole("button", { name: "결제 등록", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page
    .getByRole("button", { name: "한유나", exact: true })
    .first()
    .click();
  await panel
    .getByRole("button", { name: "미사용 전액 환불", exact: true })
    .click();
  await panel.getByLabel("환불 사유").fill("미사용 전액 환불 요청");
  await panel
    .getByRole("button", { name: "미사용 전액 환불", exact: true })
    .click();
  await expect(panel.locator(".badge")).toHaveText("환불");
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await page.goto("/app/gangnam/reservations");
  await page.getByRole("button", { name: "예약 등록", exact: true }).click();
  await panel
    .getByLabel("회원", { exact: true })
    .selectOption({ label: "한유나" });
  await panel
    .getByLabel("스터디룸", { exact: true })
    .selectOption({ label: "스터디룸 A" });
  await panel.getByLabel("시작 일시").fill("2026-10-18T14:00");
  await panel.getByLabel("종료 일시").fill("2026-10-18T16:00");
  await panel.getByLabel("이용 인원").fill("3");
  await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: "예약 등록", exact: true }).click();
  await panel
    .getByLabel("회원", { exact: true })
    .selectOption({ label: "한유나" });
  await panel
    .getByLabel("스터디룸", { exact: true })
    .selectOption({ label: "스터디룸 A" });
  await panel.getByLabel("시작 일시").fill("2026-10-18T14:00");
  await panel.getByLabel("종료 일시").fill("2026-10-18T16:00");
  await panel.getByLabel("이용 인원").fill("3");
  await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("이미 예약된 시간");
  await expect(panel.getByLabel("시작 일시")).toHaveValue("2026-10-18T14:00");
});
test("AI SSE result matches the ordinary sales ledger and supports cancellation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/sales");
  await expect(
    page.getByRole("cell", { name: "300,000원", exact: true }).first(),
  ).toBeVisible();
  await page.goto("/app/all/ai");
  await page
    .getByLabel("어떤 데이터가 궁금하신가요?")
    .fill("지난달 지점별 매출을 보여줘");
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await expect(page.getByText("조회 완료", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "300,000원", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "100,000원", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await page.getByRole("button", { name: "조회 취소", exact: true }).click();
  await expect(page.getByText("취소됨", { exact: true })).toBeVisible();
});
test("staff cannot open owner menus or read another branch through HTTP", async ({
  page,
}) => {
  await login(page, "직원");
  await page.goto("/app/gangnam/employees");
  await expect(
    page.getByRole("heading", { name: "직원 관리 권한이 없어요" }),
  ).toBeVisible();
  await page.goto("/app/seongsu/tasks");
  await expect(page.getByText("이 지점에 접근할 수 없어요")).toBeVisible();
  const statuses = await page.evaluate(async () => {
    return Promise.all(
      ["/api/payments?scope=gangnam", "/api/tasks?scope=seongsu"].map(
        async (url) => (await fetch(url)).status,
      ),
    );
  });
  expect(statuses).toEqual([403, 403]);
});
