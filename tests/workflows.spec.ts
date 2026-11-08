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
test("assigned staff completes a task and the list reflects the new status", async ({
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
  await panel.getByLabel("기한").fill("2026-10-17T18:00");
  await panel.getByLabel("체크리스트").fill("필터 상태 확인\n온도 확인");
  await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page
    .getByRole("button", { name: "스터디룸 냉방 점검 E2E", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "운영 채널에 공유" }),
  ).toHaveCount(0);
  await switchUser(page, "junho");
  await page.goto("/app/gangnam/tasks");
  await page
    .getByRole("button", { name: "스터디룸 냉방 점검 E2E", exact: true })
    .click();
  await panel.getByRole("checkbox", { name: "필터 상태 확인" }).click();
  await expect(
    panel.getByRole("checkbox", { name: "필터 상태 확인" }),
  ).toBeChecked();
  await panel.getByRole("button", { name: "완료하기", exact: true }).click();
  await panel.getByRole("button", { name: "완료하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "할 일로 변경", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
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
  await page.getByRole("button", { name: "Mock 결제", exact: true }).click();
  const panel = page.getByRole("dialog");
  const customer = panel.getByLabel("고객 선택");
  await expect(
    customer.locator("option").filter({ hasText: "한유나" }),
  ).toBeAttached();
  await customer.selectOption(
    (await customer
      .locator("option")
      .filter({ hasText: "한유나" })
      .getAttribute("value"))!,
  );
  const product = panel.getByRole("combobox", {
    name: "판매 상품",
    exact: true,
  });
  await expect(
    product.locator("option").filter({ hasText: "루틴 기간권 4주" }),
  ).toBeAttached();
  await product.selectOption(
    (await product
      .locator("option")
      .filter({ hasText: "루틴 기간권 4주" })
      .getAttribute("value"))!,
  );
  const paymentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/payments",
  );
  await panel
    .getByRole("button", { name: "Mock 결제 요청", exact: true })
    .click();
  const payment = await (await paymentResponse).json();
  await expect(panel.getByText("결제 승인", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "확인", exact: true }).click();
  await page
    .getByRole("button", { name: `결제 상세: ${payment.id}`, exact: true })
    .click();
  await panel.getByRole("button", { name: "전액 환불", exact: true }).click();
  await panel.getByLabel("환불 사유").fill("미사용 전액 환불 요청");
  await panel
    .getByRole("button", { name: "전액 환불 확정", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "전액 환불 완료" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  async function reservationForm() {
    await page.goto("/app/gangnam/reservations?detail=new");
    const reservationCustomer = panel.getByLabel("고객 선택");
    const customerOption = reservationCustomer
      .locator("option")
      .filter({ hasText: "한유나" });
    await expect(customerOption).toBeAttached();
    await reservationCustomer.selectOption(
      (await customerOption.getAttribute("value"))!,
    );
    const room = panel.getByLabel("예약 룸", { exact: true });
    const roomOption = room.locator("option").filter({ hasText: "스터디룸 A" });
    await expect(roomOption).toBeAttached();
    await room.selectOption((await roomOption.getAttribute("value"))!);
    await panel.getByLabel("예약 날짜").fill("2026-10-18");
    await panel.getByLabel("시작 시각 (한국 시간)").selectOption("14");
    await panel.getByLabel("이용 시간", { exact: true }).selectOption("2");
    await panel.getByLabel("이용 인원").fill("3");
  }
  await reservationForm();
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/room-reservations",
  );
  await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(
    panel.getByRole("heading", { name: "스터디룸 A 예약", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await reservationForm();
  await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
  await expect(
    panel.getByText(/선택 시간이 다른 예약과 겹칩니다/),
  ).toBeVisible();
  await expect(panel.getByLabel("예약 날짜")).toHaveValue("2026-10-18");
  await expect(panel.getByLabel("시작 시각 (한국 시간)")).toHaveValue("14");
});
test("AI renders JSON results and cancels a pending question", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/chat");
  const query = page.getByLabel("AI에게 질문", { exact: true });
  const submit = page.getByRole("button", { name: "질문하기", exact: true });
  const question = "지난달 지점별 매출을 보여줘";
  await query.fill(question);
  const result = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/ai/queries" &&
      response.request().method() === "POST",
  );
  await submit.click();
  expect((await result).ok()).toBe(true);
  await expect(
    page.getByRole("article", { name: "AI 답변" }).getByText(/기준 시각/),
  ).toBeVisible();

  await mock(page, { scenario: "slow" });
  await query.fill(question);
  await submit.click();
  await page.getByRole("button", { name: "질문 취소", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("질문을 취소했어요.");
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
      [
        "/api/payments?scope=gangnam",
        "/api/tasks?scope=seongsu",
        "/api/seats?scope=gangnam",
        "/api/seats?scope=seongsu",
        "/api/seats/seongsu-seat-1",
      ].map(async (url) => (await fetch(url)).status),
    );
  });
  expect(statuses).toEqual([403, 403, 200, 403, 404]);
});
