import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { components } from "../../src/shared/api/foundation.generated";

type Payment = components["schemas"]["Payment"];
const password = process.env.PAYMENT_LIVE_PASSWORD;
const ownerEmail = process.env.PAYMENT_LIVE_OWNER_EMAIL;
const sellerEmail = process.env.PAYMENT_LIVE_SELLER_EMAIL;
const readerEmail = process.env.PAYMENT_LIVE_READER_EMAIL;
const branchId = process.env.PAYMENT_LIVE_BRANCH_ID || "1";
const baseURL = process.env.PAYMENT_LIVE_BASE_URL || "http://127.0.0.1:15180";

test.beforeAll(() => {
  if (!password || !ownerEmail || !sellerEmail || !readerEmail)
    throw new Error(
      "Prepare disposable Backend/MySQL and PAYMENT_LIVE_* accounts using docs/testing/payment-live.md.",
    );
});
async function login(browser: Browser, email = ownerEmail!) {
  const context = await browser.newContext({
    baseURL,
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
  key = randomUUID(),
) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.post(`/api${path}`, {
    headers: { "X-CSRF-Token": token, "Idempotency-Key": key },
    data: body,
  });
}
async function fixture(context: BrowserContext, kind = "시간권") {
  const suffix = randomUUID().slice(0, 8);
  const customerResponse = await api(context, "/customers?scope=all", {
    registeredBranchId: branchId,
    name: `결제 검증 ${suffix}`,
    phone: "01099112233",
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await customerResponse.json();
  const categoryResponse = await api(context, "/product-categories", {
    code: `P${suffix.replaceAll("-", "").toUpperCase()}`,
    name: `검증 ${suffix}`,
    kind,
  });
  expect(categoryResponse.status()).toBe(201);
  const category = await categoryResponse.json();
  const terms =
    kind === "시간권"
      ? { kind, includedMinutes: 600, validDays: null }
      : kind === "정액권"
        ? { kind, creditKrw: 50000, hourlyRateKrw: 2000, validDays: null }
        : { kind, periodDays: 7 };
  const productResponse = await api(context, "/products?scope=all", {
    name: `검증 상품 ${suffix}`,
    priceKrw: 17500,
    terms,
    status: "판매 중",
    categoryId: category.id,
    branchIds: [branchId],
  });
  expect(productResponse.status()).toBe(201);
  return { customer, product: await productResponse.json() };
}
async function createForm(page: Page, customerId: string, productId: string) {
  await page.goto("/app/all/payments?detail=new");
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByText("Mock 결제·실제 금전 이동 없음", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "판매 지점", exact: true })
    .selectOption(branchId);
  await expect(
    panel.getByLabel("고객 선택").locator(`option[value="${customerId}"]`),
  ).toBeAttached();
  await panel.getByLabel("고객 선택").selectOption(customerId);
  await expect(
    panel
      .getByRole("combobox", { name: "판매 상품", exact: true })
      .locator(`option[value="${productId}"]`),
  ).toBeAttached();
  await panel
    .getByRole("combobox", { name: "판매 상품", exact: true })
    .selectOption(productId);
  return panel;
}
const paymentResponse = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/payments",
  );

test("real API: approval and failure persist with server price and type-specific passes", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    for (const kind of ["시간권", "정액권", "기간권"]) {
      const { customer, product } = await fixture(context, kind);
      const panel = await createForm(page, customer.id, product.id);
      const responsePromise = paymentResponse(page);
      await panel
        .getByRole("button", { name: "Mock 결제 요청", exact: true })
        .click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      const payment: Payment = await response.json();
      expect(payment.amountKrw).toBe(17500);
      expect(payment.status).toBe("승인");
      expect(payment.mock).toBe(true);
      await expect(
        panel.getByText("서버 산정 금액: 17,500원", { exact: true }),
      ).toBeVisible();
      await page.goto(`/app/all/members?tab=passes&customerId=${customer.id}`);
      await page.reload();
      await expect(
        page.getByRole("cell", { name: product.name, exact: false }),
      ).toBeVisible();
      if (kind !== "기간권")
        await expect(
          page.getByRole("cell", { name: "만료 없음", exact: true }),
        ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "시작 일시" }),
      ).toBeVisible();
      if (kind === "시간권")
        await expect(
          page.getByRole("cell", { name: "600분", exact: true }),
        ).toBeVisible();
      if (kind === "정액권")
        await expect(
          page.getByRole("cell", { name: "50,000원", exact: true }),
        ).toBeVisible();
      const failedPanel = await createForm(page, customer.id, product.id);
      await failedPanel.getByLabel("Mock 결제 결과").selectOption("FAILED");
      const failedPromise = paymentResponse(page);
      await failedPanel
        .getByRole("button", { name: "Mock 결제 요청", exact: true })
        .click();
      const failed: Payment = await (await failedPromise).json();
      expect(failed.status).toBe("실패");
      expect(failed.passId).toBeNull();
      await expect(
        failedPanel.getByText(
          "실패 결제를 기록했으며 이용권은 발급되지 않았어요.",
        ),
      ).toBeVisible();
      const passes = await (
        await api(context, `/passes?scope=all&customerId=${customer.id}`)
      ).json();
      expect(passes.meta.total).toBe(1);
      await page.goto(
        `/app/all/payments?status=실패&branchId=${branchId}&customerId=${customer.id}`,
      );
      await page.reload();
      await expect(
        page.getByRole("button", {
          name: `결제 상세: ${failed.id}`,
          exact: true,
        }),
      ).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test("real committed response loss: payment and refund reuse the same keys without duplicate rows", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    const { customer, product } = await fixture(context);
    const panel = await createForm(page, customer.id, product.id);
    const keys: string[] = [];
    let first: Payment | undefined;
    await page.route("**/api/payments?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      if (!first) {
        expect(response.status()).toBe(201);
        first = await response.json();
        return route.abort("connectionreset");
      }
      return route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "Mock 결제 요청", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "같은 결제 다시 시도" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "같은 결제 다시 시도" }).click();
    await expect(panel.getByText("결제 승인", { exact: true })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(
      (
        await (
          await api(context, `/payments?scope=all&customerId=${customer.id}`)
        ).json()
      ).meta.total,
    ).toBe(1);
    expect(
      (
        await (
          await api(context, `/passes?scope=all&customerId=${customer.id}`)
        ).json()
      ).meta.total,
    ).toBe(1);
    await page.unroute("**/api/payments?**");
    await page.goto(`/app/all/payments?detail=${first!.id}`);
    const detail = page.getByRole("dialog");
    await detail
      .getByRole("button", { name: "전액 환불", exact: true })
      .click();
    await detail.getByLabel("환불 사유").fill("응답 유실 재시도 검증");
    const refundKeys: string[] = [];
    await page.route("**/api/payments/*/refund?**", async (route) => {
      refundKeys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (refundKeys.length === 1) return route.abort("connectionreset");
      return route.fulfill({ response });
    });
    await detail.getByRole("button", { name: "전액 환불 확정" }).click();
    await expect(
      detail.getByRole("button", { name: "같은 환불 다시 시도" }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "같은 환불 다시 시도" }).click();
    await expect(
      detail.getByRole("heading", { name: "전액 환불 완료" }),
    ).toBeVisible();
    expect(refundKeys).toHaveLength(2);
    expect(refundKeys[0]).toBe(refundKeys[1]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "전액 환불 완료" }),
    ).toBeVisible();
    const refunded: Payment = await (
      await api(context, `/payments/${first!.id}?scope=all`)
    ).json();
    expect(refunded.status).toBe("환불");
    expect(refunded.amountKrw).toBe(first!.amountKrw);
    expect(refunded.approvedAt).toBe(first!.approvedAt);
  } finally {
    await context.close();
  }
});

test("real permissions: write-only cashier refunds from pass; reader and foreign scope are denied", async ({
  browser,
}) => {
  const owner = await login(browser);
  let seller: Awaited<ReturnType<typeof login>> | undefined;
  let reader: Awaited<ReturnType<typeof login>> | undefined;
  try {
    const { customer, product } = await fixture(owner.context);
    const body = {
      customerId: customer.id,
      branchId,
      productId: product.id,
      method: "카드",
      mockOutcome: "APPROVED",
    };
    const payment: Payment = await (
      await api(owner.context, "/payments", body)
    ).json();
    reader = await login(browser, readerEmail!);
    await reader.page.goto(
      `/app/${branchId}/members?tab=passes&detail=${payment.passId}`,
    );
    await expect(
      reader.page.getByRole("dialog").getByText(product.name, { exact: false }),
    ).toBeVisible();
    await expect(
      reader.page.getByRole("button", { name: "전액 환불", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await api(reader.context, `/payments/${payment.id}/refund`, {
          reason: "권한 검증",
        })
      ).status(),
    ).toBe(403);
    expect([403, 404]).toContain(
      (await api(reader.context, `/payments/${payment.id}?scope=2`)).status(),
    );
    seller = await login(browser, sellerEmail!);
    await seller.page.goto(`/app/${branchId}/payments`);
    await expect(
      seller.page.getByText("결제 목록 조회 권한이 없어요", { exact: true }),
    ).toBeVisible();
    await seller.page.goto(
      `/app/${branchId}/members?tab=passes&detail=${payment.passId}`,
    );
    const panel = seller.page.getByRole("dialog");
    await expect(panel.getByRole("link", { name: "원결제 상세" })).toHaveCount(
      0,
    );
    await panel.getByRole("button", { name: "전액 환불", exact: true }).click();
    await panel.getByLabel("환불 사유").fill("계산원 원결제 지점 환불 검증");
    await panel.getByRole("button", { name: "전액 환불 확정" }).click();
    await expect(
      panel.getByRole("heading", { name: "전액 환불 완료" }),
    ).toBeVisible();
    const final: Payment = await (
      await api(owner.context, `/payments/${payment.id}`)
    ).json();
    expect(final.refund?.processingBranchId).toBe(branchId);
    expect(final.status).toBe("환불");
  } finally {
    await Promise.all([
      owner.context.close(),
      seller?.context.close(),
      reader?.context.close(),
    ]);
  }
});
