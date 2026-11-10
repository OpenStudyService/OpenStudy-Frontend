import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
vi.mock("../shared/api/client", async (original) => ({
  ...(await original<typeof import("../shared/api/client")>()),
  MOCK: true,
}));
import { salesHandlers } from "./sales";
import { paymentHandlers, salesProductSnapshot } from "./payments";
import { dailyClosingHandlers } from "./daily-closings";
import { roomHandlers } from "./rooms";
import { lockerHandlers } from "./lockers";
import { store } from "./store";
import {
  salesApi,
  type SalesLedgerPage,
  type RevenueSummary,
} from "../features/analysis/sales-api";

const server = setupServer(
  ...salesHandlers,
  ...paymentHandlers,
  ...dailyClosingHandlers,
  ...roomHandlers,
  ...lockerHandlers,
);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
  vi.spyOn(store, "now").mockReturnValue("2026-11-10T03:00:00.000Z");
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
const request = (
  path: string,
  method = "GET",
  body?: object,
  key = crypto.randomUUID(),
) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const range = "from=2026-10-31T15:00:00Z&to=2026-11-30T15:00:00Z";
const query = `branchIds=gangnam&branchIds=seongsu&${range}`;
const purchase = async () => {
  const result = await request("/payments", "POST", {
    customerId: "member-1",
    branchId: "gangnam",
    productId: "time100",
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(result.status).toBe(201);
  return result.json();
};

it("matches payment summary to the approved revenue card for the same approval window", async () => {
  store.db.payments = [];
  const p = await purchase();
  await purchase();
  const refund = await request(`/payments/${p.id}/refund`, "POST", {
    reason: "전액 환불",
  });
  expect(refund.status).toBe(200);
  const methods = new URLSearchParams({
    methods: "카드",
    productKinds: "시간권",
    operatorIds: p.createdBy.id,
  });
  const list = await (
    await request(`/payments?scope=gangnam&pageSize=1&${range}&${methods}`)
  ).json();
  const sales = await salesApi.revenue({
    branchIds: ["gangnam"],
    from: "2026-10-31T15:00:00Z",
    to: "2026-11-30T15:00:00Z",
    methods: ["카드"],
    productKinds: ["시간권"],
    operatorIds: [p.createdBy.id],
  });
  expect(list.items).toHaveLength(1);
  expect(list.filter).toMatchObject({
    methods: ["카드"],
    productKinds: ["시간권"],
    operatorIds: [p.createdBy.id],
  });
  expect(
    list.summary.approved.amountKrw + list.summary.refunded.amountKrw,
  ).toBe(240000);
  expect(sales.totals.approvedAmountKrw).toBe(240000);
  expect(sales.aggregation.conditionNotes.map(({ code }) => code)).toEqual(
    expect.arrayContaining([
      "PASS_ONLY",
      "OPERATOR_BY_ENTRY",
      "REFUND_BY_PAYMENT_METHOD",
    ]),
  );
});

it("replays a closing key and records later refunds in closing detail", async () => {
  store.db.payments = [];
  vi.mocked(store.now).mockReturnValue("2026-11-09T03:00:00.000Z");
  const payment = await purchase();
  vi.mocked(store.now).mockReturnValue("2026-11-10T03:00:00.000Z");
  const input = { branchId: "gangnam", businessDate: "2026-11-09" };
  const key = crypto.randomUUID();
  const response = await request("/daily-closings", "POST", input, key);
  expect(response.status).toBe(201);
  const closing = await response.json();
  expect(closing.snapshot.paymentDate.totals.netAmountKrw).toBe(120000);
  expect((await request("/daily-closings", "POST", input)).status).toBe(409);
  vi.mocked(store.now).mockReturnValue("2026-11-10T04:00:00.000Z");
  const refund = await request(`/payments/${payment.id}/refund`, "POST", {
    reason: "마감 후 전액 환불",
  });
  expect(refund.status).toBe(200);
  const detail = await (await request(`/daily-closings/${closing.id}`)).json();
  expect(detail).toMatchObject({
    snapshot: closing.snapshot,
    difference: { netAmountKrw: -120000 },
    current: { paymentDate: { netAmountKrw: 0 } },
    adjustments: [
      {
        reason: "마감 후 전액 환불",
        amountKrw: -120000,
        processedBy: { id: payment.createdBy.id },
      },
    ],
  });
  expect(
    await (await request("/daily-closings", "POST", input, key)).json(),
  ).toEqual(closing);
  expect(
    await (await request("/daily-closings?branchIds=gangnam")).json(),
  ).toMatchObject({
    items: [{ id: closing.id, adjustmentCount: 1 }],
  });
});

it("aggregates seat use by usage branch and keeps the sale branch separate", async () => {
  const seed = store.db.usage.find((row) =>
    store.db.passes.some((p) => p.id === row.passId && p.kind === "시간권"),
  )!;
  const pass = store.db.passes.find((p) => p.id === seed.passId)!;
  store.db.usage = [
    {
      ...seed,
      branchId: pass.branchId === "gangnam" ? "seongsu" : "gangnam",
      startedAt: "2026-11-09T00:00:00Z",
      endedAt: "2026-11-09T01:00:00Z",
      status: "완료",
      charged: 60,
    },
  ];
  const usageBranchId = store.db.usage[0].branchId;
  const response = await request(
    `/sales/passes/usage?branchIds=${usageBranchId}&${range}`,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    totals: { sessionCount: 1, usedMinutes: 60, usedCreditKrw: 0 },
    aggregation: {
      sourceRowCount: 2,
      condition: { branchIds: [usageBranchId], refundBasis: null },
      conditionNotes: [{ code: "USAGE_NOT_REVENUE" }],
    },
    items: [
      {
        branchId: usageBranchId,
        bySaleBranch: [{ saleBranchId: pass.branchId, visible: true }],
      },
    ],
  });
});

it("keeps revenue, branch comparison and paged ledger over the same approved/refund source", async () => {
  store.db.payments = [];
  const payment = await purchase();
  expect(
    (
      await request(`/payments/${payment.id}/refund`, "POST", {
        reason: "전액 환불",
      })
    ).status,
  ).toBe(200);
  const revenue = (await (
    await request(`/sales/revenue?${query}`)
  ).json()) as RevenueSummary;
  const branches = await (
    await request(`/sales/revenue/branches?${query}&sort=requested`)
  ).json();
  const ledger = (await (
    await request(`/sales/ledger?${query}&pageSize=1`)
  ).json()) as SalesLedgerPage;
  expect(revenue.totals).toMatchObject({
    approvedAmountKrw: 120000,
    refundAmountKrw: 120000,
    netAmountKrw: 0,
    approvedPaymentCount: 1,
    refundCount: 1,
    dataStatus: "hasData",
  });
  expect(branches.totals).toEqual(revenue.totals);
  expect(ledger.totals).toEqual(revenue.totals);
  expect(ledger.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
  expect(ledger.items).toHaveLength(1);
  expect(
    branches.items.map((row: { branchId: string }) => row.branchId),
  ).toEqual(["gangnam", "seongsu"]);
  expect(branches.items[1].dataStatus).toBe("noData");
  const later = await (
    await request(`/sales/ledger?${query}&page=3&pageSize=1`)
  ).json();
  expect(later.items).toEqual([]);
  expect(later.meta.total).toBe(2);
  expect(later.aggregation.sourceRowCount).toBe(2);
  const refunds = await (
    await request(
      `/sales/ledger?${query}&entryType=${encodeURIComponent("환불")}`,
    )
  ).json();
  expect(refunds.meta.total).toBe(1);
  expect(refunds.totals).toMatchObject({
    approvedAmountKrw: 0,
    refundAmountKrw: 120000,
    netAmountKrw: -120000,
    approvedPaymentCount: 0,
    refundCount: 1,
  });
});

it("uses Korean half-open boundaries and original payment branch for refunds in both bases", async () => {
  store.db.payments = [];
  const payment = await purchase(),
    row = store.get("payments", payment.id);
  row.approvedAt = "2026-10-31T14:59:59.999Z";
  row.refundAt = "2026-11-02T01:00:00.000Z";
  row.refundBranchId = "seongsu";
  row.status = "환불";
  const processed = await (await request(`/sales/revenue?${query}`)).json();
  expect(processed.totals).toMatchObject({
    approvedAmountKrw: 0,
    refundAmountKrw: 120000,
    netAmountKrw: -120000,
  });
  const original = await (
    await request(`/sales/revenue?${query}&refundBasis=paymentDate`)
  ).json();
  expect(original.totals.dataStatus).toBe("noData");
  const ledger = await (await request(`/sales/ledger?${query}`)).json();
  expect(ledger.items[0]).toMatchObject({
    branchId: "gangnam",
    processingBranchId: "seongsu",
    amountKrw: -120000,
  });
  row.approvedAt = "2026-10-31T15:00:00.000Z";
  row.refundAt = "2026-11-30T15:00:00.000Z";
  expect(
    (await (await request(`/sales/revenue?${query}`)).json()).totals,
  ).toMatchObject({ approvedAmountKrw: 120000, refundAmountKrw: 0 });
});

it("reads actual room and locker charges alongside pass payments without adding consumption", async () => {
  store.db.payments = [];
  await purchase();
  const room = await request("/room-reservations", "POST", {
    branchId: "gangnam",
    roomId: "gangnam-room-a",
    customerId: "member-1",
    startAt: "2026-11-11T00:00:00+09:00",
    endAt: "2026-11-11T01:00:00+09:00",
    partySize: 2,
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(room.status).toBe(201);
  const locker = await request("/locker-assignments", "POST", {
    branchId: "gangnam",
    lockerId: "gangnam-locker-1",
    customerId: "member-1",
    startDate: "2026-11-10",
    endDate: "2026-12-08",
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(locker.status).toBe(201);
  const result = await (await request(`/sales/revenue?${query}`)).json();
  expect(
    result.byPurpose.map(
      (v: { approvedPaymentCount: number }) => v.approvedPaymentCount,
    ),
  ).toEqual([1, 1, 1]);
  const paymentSum = store.db.payments.reduce((n, p) => n + p.amount, 0);
  expect(result.totals.approvedAmountKrw).toBe(paymentSum);
  expect(result.aggregation.sourceRowCount).toBe(3);
  const roomsOnly = await (
    await request(
      `/sales/revenue?${query}&purpose=${encodeURIComponent("스터디룸")}`,
    )
  ).json();
  expect(roomsOnly.byPurpose).toHaveLength(1);
  expect(roomsOnly.byPurpose[0].purpose).toBe("스터디룸");
  expect(roomsOnly.totals.approvedPaymentCount).toBe(1);
  const ledger = await (await request(`/sales/ledger?${query}`)).json();
  for (const entry of ledger.items) {
    expect(entry).not.toHaveProperty("customerId");
    expect(entry).not.toHaveProperty("customer");
    if (entry.purpose !== "이용권")
      expect(entry).toMatchObject({
        productId: null,
        productName: null,
        passQuantity: 0,
      });
  }
});

it("keeps sale-time product/category snapshots after renaming and ignores failed charges", async () => {
  store.db.payments = [];
  const payment = await purchase(),
    product = store.get("products", "time100");
  const old = salesProductSnapshot(store.get("payments", payment.id));
  product.name = "새 상품명";
  store.get("productCategories", product.categoryId).name = "새 분류";
  const failed = await request("/payments", "POST", {
    customerId: "member-1",
    branchId: "gangnam",
    productId: "time100",
    method: "카드",
    mockOutcome: "FAILED",
  });
  expect(failed.status).toBe(201);
  const ledger = await (await request(`/sales/ledger?${query}`)).json();
  expect(ledger.meta.total).toBe(1);
  expect(ledger.items[0]).toMatchObject({
    productName: old.productName,
    categoryCode: old.categoryCode,
    categoryName: old.categoryName,
  });
  const products = await (
    await request(`/sales/passes/products?${query}`)
  ).json();
  expect(products.items).toHaveLength(1);
  expect(products.items[0]).toMatchObject({
    ...old,
    rank: 1,
    netSoldQuantity: 1,
  });
  expect(products.totals).toMatchObject({ paymentCount: 1, issuedCount: 1 });
});

it("rejects unknown/unauthorized branches together, and separately protects payment links", async () => {
  store.db.payments = [];
  await purchase();
  store.persona = "junho";
  const employee = store.user();
  employee.memberships[0].permissions.push("sales:read");
  employee.memberships[0].permissions =
    employee.memberships[0].permissions.filter((v) => v !== "payments:read");
  expect(
    (
      await request(
        `/sales/revenue?branchIds=gangnam&branchIds=seongsu&${range}`,
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(`/sales/revenue?branchIds=unknown&${range}`)).status,
  ).toBe(403);
  const ledger = await (
    await request(`/sales/ledger?branchIds=gangnam&${range}`)
  ).json();
  expect(ledger.items[0].canViewPayment).toBe(false);
  expect(ledger.aggregation.condition.branchIds).toEqual(["gangnam"]);
  employee.memberships[0].permissions = [];
  expect((await request("/sales/revenue")).status).toBe(403);
});

it("validates period limits and reports defaults, empty values and filtered counts", async () => {
  expect(
    (
      await request(
        `/sales/revenue?from=2026-01-01T00:00:00Z&to=2027-01-03T00:00:00Z`,
      )
    ).status,
  ).toBe(422);
  const tooLong = await (
    await request(
      `/sales/revenue?from=2026-01-01T00:00:00Z&to=2027-01-03T00:00:00Z`,
    )
  ).json();
  expect(tooLong.code).toBe("PERIOD_TOO_LONG");
  expect(
    (await request("/sales/revenue?from=2026-11-01T00:00:00Z")).status,
  ).toBe(422);
  expect(
    (await request("/sales/revenue?branchIds=gangnam&branchIds=gangnam"))
      .status,
  ).toBe(422);
  expect((await request("/sales/revenue?productId=time100")).status).toBe(422);
  store.scenario = "empty";
  const empty = await (await request("/sales/revenue")).json();
  expect(empty.aggregation).toMatchObject({
    defaultPeriod: true,
    dataStatus: "noData",
    sourceRowCount: 0,
    condition: {
      from: "2026-10-31T15:00:00.000Z",
      to: "2026-11-10T15:00:00.000Z",
      allBranches: true,
    },
  });
  expect(empty.totals).toMatchObject({ netAmountKrw: 0, dataStatus: "noData" });
  expect(empty.byPurpose).toHaveLength(3);
});

it("passes strict live-boundary validators using the canonical mock wire shape", async () => {
  store.db.payments = [];
  await purchase();
  const condition = {
    branchIds: ["gangnam", "seongsu"],
    from: "2026-10-31T15:00:00.000Z",
    to: "2026-11-30T15:00:00.000Z",
  };
  const revenue = await salesApi.revenue(condition);
  expect((await salesApi.branches(condition)).totals).toEqual(revenue.totals);
  expect((await salesApi.ledger(condition)).totals).toEqual(revenue.totals);
});
