import { expect, test, type Page } from "@playwright/test";
import type { components } from "../src/shared/api/foundation.generated";

type Payment = components["schemas"]["Payment"];
const notice = "Mock 결제·실제 금전 이동 없음";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/gangnam/payments");
  await expect(
    page.getByRole("heading", { name: "결제", exact: true }),
  ).toBeVisible();
}
async function api(page: Page, path: string, body?: object) {
  return page.evaluate(
    async ({ path, body }) => {
      const { token } = await fetch("/api/auth/csrf").then((response) =>
        response.json(),
      );
      const response = await fetch(
        `/api${path}`,
        body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": token,
                "Idempotency-Key": crypto.randomUUID(),
              },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      return { status: response.status, data: await response.json() };
    },
    { path, body },
  );
}
async function purchase(
  page: Page,
  outcome: "APPROVED" | "FAILED" = "APPROVED",
  customerId = "member-1",
) {
  await page.getByRole("button", { name: "Mock 결제", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(notice, { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("combobox", { name: "고객 선택", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("combobox", { name: "고객 선택", exact: true })
    .selectOption(customerId);
  await expect(
    panel
      .getByRole("combobox", { name: "판매 상품", exact: true })
      .locator('option[value="time100"]'),
  ).toBeAttached();
  await panel
    .getByRole("combobox", { name: "판매 상품", exact: true })
    .selectOption("time100");
  await panel
    .getByRole("combobox", { name: "Mock 결제 결과", exact: true })
    .selectOption(outcome);
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/payments",
  );
  const received = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/payments",
  );
  await panel
    .getByRole("button", { name: "Mock 결제 요청", exact: true })
    .click();
  const request = await sent,
    response = await received;
  expect(response.status()).toBe(201);
  expect(request.headers()["idempotency-key"]).toBeTruthy();
  expect(request.postDataJSON()).toEqual({
    customerId,
    branchId: "gangnam",
    productId: "time100",
    method: "카드",
    mockOutcome: outcome,
  });
  const payment = (await response.json()) as Payment;
  await expect(
    panel.getByRole("heading", {
      name: `결제 ${outcome === "APPROVED" ? "승인" : "실패"}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText("서버 산정 금액: 120,000원", { exact: true }),
  ).toBeVisible();
  return payment;
}

test("MSW: approval, purchase snapshot detail and unused full refund", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const payment = await purchase(page);
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "확인", exact: true }).click();
  await page
    .getByRole("button", { name: `결제 상세: ${payment.id}`, exact: true })
    .click();
  await expect(panel.getByText("발급 이용권", { exact: true })).toBeVisible();
  await expect(panel.getByText("6,000분", { exact: true })).toBeVisible();
  await expect(panel.getByText("시작 일시", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "전액 환불", exact: true }).click();
  await panel.getByLabel("환불 사유").fill("Chrome MSW 미사용 전액 환불");
  const refund = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/payments/${payment.id}/refund`,
  );
  await panel
    .getByRole("button", { name: "전액 환불 확정", exact: true })
    .click();
  const refunded = (await (await refund).json()) as Payment;
  expect(refunded).toMatchObject({
    amountKrw: payment.amountKrw,
    approvedAt: payment.approvedAt,
    status: "환불",
    refund: { amountKrw: payment.amountKrw, processingBranchId: "gangnam" },
  });
  await expect(
    panel.getByRole("heading", { name: "전액 환불 완료", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(notice, { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("payment-refund-desktop.png"),
    fullPage: true,
  });
  const pass = await api(page, `/passes/${payment.passId}?scope=gangnam`);
  expect(pass.data).toMatchObject({ status: "환불", canRefund: false });
  expect(errors).toEqual([]);
});

test("MSW: failed payment issues no pass and date/status filters use canonical timestamps", async ({
  page,
}) => {
  await login(page);
  const before = await api(page, "/passes?scope=gangnam&customerId=member-1");
  const payment = await purchase(page, "FAILED");
  expect(payment.passId).toBeNull();
  await expect(
    page
      .getByRole("dialog")
      .getByText("실패 결제를 기록했으며 이용권은 발급되지 않았어요.", {
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  const after = await api(page, "/passes?scope=gangnam&customerId=member-1");
  expect(after.data.meta.total).toBe(before.data.meta.total);
  await page.getByLabel("결제 상태 필터").selectOption("실패");
  const startResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/payments" &&
      new URL(response.url()).searchParams.has("from"),
  );
  await page.getByLabel("결제 기간 시작").fill("2026-10-01");
  expect((await startResponse).status()).toBe(200);
  const endResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/payments" &&
      new URL(response.url()).searchParams.has("to"),
  );
  await page.getByLabel("결제 기간 종료").fill("2026-11-01");
  const filtered = await endResponse;
  expect(filtered.status()).toBe(200);
  const params = new URL(filtered.url()).searchParams;
  expect(params.get("from")).toBe("2026-09-30T15:00:00.000Z");
  expect(params.get("to")).toBe("2026-11-01T15:00:00.000Z");
  await page
    .getByRole("button", { name: `결제 상세: ${payment.id}`, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "전액 환불", exact: true }),
  ).toHaveCount(0);
});

test("MSW: mobile pass detail hides refunds after actual seat use", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const payment = await purchase(page, "APPROVED", "member-6");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  const seats = await api(page, "/seats?scope=gangnam&pageSize=100");
  const seat = seats.data.items.find(
    (row: { status: string }) => row.status === "이용 가능",
  );
  expect(seat).toBeTruthy();
  const assigned = await api(page, `/seats/${seat.id}/assign`, {
    version: seat.version,
    memberId: "member-6",
    passId: payment.passId,
  });
  expect(assigned.status).toBe(200);
  await page.goto(`/app/gangnam/members?tab=passes&detail=${payment.passId}`);
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("heading", { name: "보유 이용권 상세", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("사용 이력", { exact: true })).toBeVisible();
  await expect(panel.getByText("있음", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "전액 환불", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText(notice, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("payment-used-pass-mobile.png"),
    fullPage: true,
  });
  const rejected = await api(page, `/payments/${payment.id}/refund`, {
    reason: "사용 후 거절 확인",
  });
  expect(rejected.status).toBe(409);
  expect(rejected.data.code).toBe("PASS_ALREADY_USED");
});
