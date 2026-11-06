import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { formatKrw } from "../../src/shared/domain/format";

const password = process.env.SALES_LIVE_PASSWORD;
test.beforeAll(() => {
  if (!password)
    throw new Error("Prepare a disposable Backend/DB and SALES_LIVE_PASSWORD.");
});
async function login(context: BrowserContext, email = "owner@sales.test") {
  expect(
    (await api(context, "/auth/login", { email, password })).status(),
  ).toBe(200);
}
async function api(context: BrowserContext, path: string, body?: object) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.post(`/api${path}`, {
    headers: { "X-CSRF-Token": token, "Idempotency-Key": randomUUID() },
    data: body,
  });
}
async function transactions(context: BrowserContext) {
  const suffix = randomUUID().slice(0, 8);
  const customer = await api(context, "/customers?scope=all", {
    registeredBranchId: "1",
    name: `Sales ${suffix}`,
    phone: "01099112233",
  });
  expect(customer.status()).toBe(201);
  const { id: customerId } = await customer.json();
  const category = await api(context, "/product-categories", {
    code: `S${suffix.toUpperCase()}`,
    name: `Sales ${suffix}`,
    kind: "시간권",
  });
  expect(category.status()).toBe(201);
  const { id: categoryId } = await category.json();
  const product = await api(context, "/products?scope=all", {
    name: `Sales product ${suffix}`,
    priceKrw: 17500,
    terms: { kind: "시간권", includedMinutes: 600, validDays: null },
    status: "판매 중",
    categoryId,
    branchIds: ["1", "2"],
  });
  expect(product.status()).toBe(201);
  const { id: productId } = await product.json();
  const ids: string[] = [];
  for (let n = 0; n < 2; n++) {
    const payment = await api(context, "/payments", {
      customerId,
      branchId: "1",
      productId,
      method: "카드",
      mockOutcome: "APPROVED",
    });
    expect(payment.status()).toBe(201);
    ids.push((await payment.json()).id);
  }
  const refund = await api(context, `/payments/${ids[0]}/refund`, {
    reason: "Sales totals verification",
  });
  expect(refund.status()).toBe(200);
  return ids;
}

test("real API: approved/refunded totals agree across cards, branch comparison and ledger after reload", async ({
  page,
  context,
}) => {
  // Prepare transactions before opening a page: fixture writes should not make
  // the unrelated home screen repeatedly refresh through workspace SSE.
  expect(
    (
      await api(context, "/auth/login", {
        email: "owner@sales.test",
        password,
      })
    ).status(),
  ).toBe(200);
  const ids = await transactions(context);
  const revenueResponse = await api(context, "/sales/revenue");
  expect(revenueResponse.status()).toBe(200);
  const revenue = await revenueResponse.json();
  const branches = await (await api(context, "/sales/revenue/branches")).json();
  const ledger = await (
    await api(context, "/sales/ledger?pageSize=100")
  ).json();
  expect(branches.totals).toEqual(revenue.totals);
  expect(ledger.totals).toEqual(revenue.totals);
  expect(
    ledger.items.filter((x: { paymentId: string }) =>
      ids.includes(x.paymentId),
    ),
  ).toHaveLength(3);
  expect(
    ledger.items.reduce(
      (sum: number, x: { amountKrw: number }) => sum + x.amountKrw,
      0,
    ),
  ).toBe(revenue.totals.netAmountKrw);
  expect(revenue.aggregation.defaultPeriod).toBe(true);
  await page.goto("/app/all/sales");
  const summary = page.getByRole("region", { name: "매출 요약", exact: true });
  await expect(
    summary
      .getByText(formatKrw(revenue.totals.approvedAmountKrw), { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    summary
      .getByText(formatKrw(revenue.totals.refundAmountKrw), { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    summary
      .getByText(formatKrw(revenue.totals.netAmountKrw), { exact: true })
      .first(),
  ).toBeVisible();
  const origin = page.getByRole("region", {
    name: "매출 최소 원장",
    exact: true,
  });
  await expect(
    origin.getByRole("link", { name: "결제 보기" }).first(),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Sales Two", exact: true }).click();
  await expect(page).toHaveURL(/branchIds=2/);
  await expect(
    page.getByRole("checkbox", { name: "Sales Two", exact: true }),
  ).toBeChecked();
  await expect(
    summary.getByText("거래 없음", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Sales Two", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Sales Two", exact: true }),
  ).not.toBeChecked();
  await expect(
    summary
      .getByText(formatKrw(revenue.totals.netAmountKrw), { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "환불 집계 기준", exact: true })
    .selectOption("paymentDate");
  await expect(page).toHaveURL(/refundBasis=paymentDate/);
  await page
    .getByRole("combobox", { name: "결제 용도", exact: true })
    .selectOption("이용권");
  await expect(page).toHaveURL(/purpose=/);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "환불 집계 기준", exact: true }),
  ).toHaveValue("paymentDate");
  await expect(
    page.getByRole("combobox", { name: "결제 용도", exact: true }),
  ).toHaveValue("이용권");
  await expect(
    summary
      .getByText(formatKrw(revenue.totals.netAmountKrw), { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "원장 항목", exact: true })
    .selectOption("환불");
  await expect(page).toHaveURL(/entryType=/);
  const rows = origin.getByRole("table", {
    name: "매출 근거 승인·환불 항목",
    exact: true,
  });
  await expect(
    rows.getByRole("cell", { name: "환불", exact: true }).first(),
  ).toBeVisible();
  await expect(
    rows.getByRole("cell", { name: "승인", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("heading", { name: "매출 조회", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-artifacts/sales-live/desktop-top.png" });
  await origin.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-artifacts/sales-live/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await origin.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-artifacts/sales-live/mobile.png" });
});

test("real API: sales-only staff sees only permitted branch and no payment links; no-sales staff is denied", async ({
  page,
  context,
  browser,
}) => {
  await login(context, "reader@sales.test");
  await page.goto("/app/all/sales");
  await expect(
    page.getByRole("checkbox", { name: "Sales One", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Sales Two", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "매출 최소 원장", exact: true })
      .getByRole("table", { name: "매출 근거 승인·환불 항목", exact: true }),
  ).toBeVisible();
  const ledger = await (await api(context, "/sales/ledger")).json();
  expect(ledger.aggregation.condition.branchIds).toEqual(["1"]);
  expect(
    ledger.items.every(
      (x: { canViewPayment: boolean }) => x.canViewPayment === false,
    ),
  ).toBe(true);
  await expect(
    page
      .getByRole("region", { name: "매출 최소 원장", exact: true })
      .getByRole("link", { name: "결제 보기" }),
  ).toHaveCount(0);
  expect(
    (await api(context, "/sales/revenue?branchIds=1&branchIds=2")).status(),
  ).toBe(403);
  const restricted = await browser.newContext({
    baseURL: process.env.SALES_LIVE_BASE_URL || "http://127.0.0.1:15330",
    serviceWorkers: "block",
  });
  try {
    const staff = await restricted.newPage();
    await login(restricted, "staff@sales.test");
    await staff.goto("/app/1/sales");
    await expect(
      staff.getByText("매출 조회 권한이 필요해요", { exact: true }),
    ).toBeVisible();
    expect((await api(restricted, "/sales/revenue")).status()).toBe(403);
  } finally {
    await restricted.close();
  }
});

test("real API: empty interval stays empty and the UI rejects over-366-day periods before querying", async ({
  page,
  context,
}) => {
  expect(
    (
      await api(context, "/auth/login", {
        email: "owner@sales.test",
        password,
      })
    ).status(),
  ).toBe(200);
  const empty = await (
    await api(
      context,
      "/sales/revenue?from=2020-01-01T00%3A00%3A00%2B09%3A00&to=2020-01-02T00%3A00%3A00%2B09%3A00",
    )
  ).json();
  expect(empty.aggregation.dataStatus).toBe("noData");
  expect(empty.totals.netAmountKrw).toBe(0);
  await page.goto("/app/all/sales?from=2020-01-01&to=2020-01-02");
  await expect(
    page
      .getByRole("region", { name: "매출 요약", exact: true })
      .getByText("거래 없음", { exact: true })
      .first(),
  ).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const from = Date.parse(url.searchParams.get("from") || "");
    const to = Date.parse(url.searchParams.get("to") || "");
    // An in-flight valid empty-period refresh can finish during navigation.
    // Only a request for the invalid range would violate the UI guard.
    if (url.pathname.startsWith("/api/sales/") && to - from > 366 * 86400000)
      requests.push(request.url());
  });
  await page.goto("/app/all/sales?from=2020-01-01&to=2022-01-01");
  await expect(page.getByText(/366일/).first()).toBeVisible();
  expect(requests).toHaveLength(0);
});
