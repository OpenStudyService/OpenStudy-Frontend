import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
import { api } from "../../shared/api/client";
import { salesApi, salesPeriod, validateSalesCondition } from "./sales-api";

const request = vi.mocked(api);
const from = "2026-10-31T15:00:00.000Z",
  to = "2026-11-30T15:00:00.000Z";
const condition = { branchIds: ["1", "2"], from, to };
const zero = {
  approvedAmountKrw: 0,
  refundAmountKrw: 0,
  netAmountKrw: 0,
  approvedPaymentCount: 0,
  refundCount: 0,
  dataStatus: "noData",
};
const netNegative = {
  approvedAmountKrw: 0,
  refundAmountKrw: 3000,
  netAmountKrw: -3000,
  approvedPaymentCount: 0,
  refundCount: 1,
  dataStatus: "hasData",
};
function fixture() {
  return {
    aggregation: {
      condition: {
        branchIds: ["1", "2"],
        allBranches: false,
        from,
        to,
        refundBasis: "processedDate",
        purpose: null,
        productId: null,
        categoryCode: null,
        granularity: null,
      },
      defaultPeriod: false,
      timeZone: "Asia/Seoul",
      currency: "KRW",
      asOf: "2026-12-01T00:00:00Z",
      rowCount: 3,
      sourceRowCount: 1,
      dataStatus: "hasData",
      partial: {
        periodOpen: false,
        firstBucketPartial: null,
        lastBucketPartial: null,
      },
      metrics: [
        { id: "sales.approved_amount", unit: "원" },
        { id: "sales.refund_amount", unit: "원" },
        { id: "sales.net_amount", unit: "원" },
        { id: "sales.approved_payment_count", unit: "건" },
        { id: "sales.refund_count", unit: "건" },
      ],
    },
    totals: { ...netNegative },
    byPurpose: [
      { purpose: "이용권", ...netNegative },
      { purpose: "스터디룸", ...zero },
      { purpose: "사물함", ...zero },
    ],
  };
}
beforeEach(() => vi.clearAllMocks());
describe("sales period", () => {
  it("uses Korean midnight and an exclusive end without host timezone dependence", () => {
    expect(salesPeriod("2026-11-01", "2026-12-01")).toEqual({ from, to });
    expect(salesPeriod("", "")).toEqual({});
    expect(salesPeriod("2028-01-01", "2029-01-01")).toBeTruthy();
  });
  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-11-01", ""],
    ["2026-11-02", "2026-11-01"],
    ["2026-01-01", "2027-01-03"],
  ])("rejects invalid or overlong periods %s — %s", (start, end) => {
    expect(() => salesPeriod(start, end)).toThrow();
  });
  it("rejects duplicate/empty branches and offsetless instants", () => {
    expect(() => validateSalesCondition({ branchIds: [] })).toThrow();
    expect(() => validateSalesCondition({ branchIds: ["1", "1"] })).toThrow();
    expect(() =>
      validateSalesCondition({ from: "2026-01-01T00:00:00", to }),
    ).toThrow();
  });
});
describe("canonical sales adapter", () => {
  it("sends repeated branches and preserves negative net revenue and null metadata", async () => {
    request.mockResolvedValue(fixture());
    const result = await salesApi.revenue(condition);
    const path = String(request.mock.calls[0][0]);
    const search = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/sales/revenue?")).toBe(true);
    expect(search.getAll("branchIds")).toEqual(["1", "2"]);
    expect(search.has("scope")).toBe(false);
    expect(result.totals.netAmountKrw).toBe(-3000);
    expect(result.aggregation.condition.productId).toBeNull();
  });
  it("omits default dates and branches and uses the actual server period", async () => {
    const response = fixture();
    response.aggregation.condition.allBranches = true;
    response.aggregation.defaultPeriod = true;
    response.aggregation.asOf = "2026-11-30T01:00:00.000Z";
    response.aggregation.partial.periodOpen = true;
    request.mockResolvedValue(response);
    const result = await salesApi.revenue({});
    expect(request).toHaveBeenCalledWith("/sales/revenue?", {
      signal: undefined,
    });
    expect(result.aggregation.condition.from).toBe(from);
  });
  it.each(["scope", "amount", "metadata", "sums", "unsafe"])(
    "rejects invalid success: %s",
    async (kind) => {
      const response = fixture();
      if (kind === "scope") response.aggregation.condition.branchIds = ["3"];
      if (kind === "amount") response.totals.netAmountKrw = 0;
      if (kind === "metadata") response.aggregation.sourceRowCount = 0;
      if (kind === "sums")
        response.byPurpose[0] = { purpose: "이용권", ...zero };
      if (kind === "unsafe")
        response.totals.refundAmountKrw = Number.MAX_SAFE_INTEGER + 1;
      request.mockResolvedValue(response);
      await expect(salesApi.revenue(condition)).rejects.toMatchObject({
        detail: { code: "INVALID_RESPONSE" },
      });
    },
  );
  it("checks branch membership, duplicate rows, totals and requested sorting params", async () => {
    const response = fixture();
    const comparison = {
      aggregation: { ...response.aggregation, rowCount: 2 },
      totals: response.totals,
      items: [
        {
          branchId: "1",
          branchName: "1호점",
          ...netNegative,
          byPurpose: response.byPurpose,
        },
        {
          branchId: "2",
          branchName: "2호점",
          ...zero,
          byPurpose: response.byPurpose.map((v) => ({ ...v, ...zero })),
        },
      ],
    };
    request.mockResolvedValue(comparison);
    await expect(
      salesApi.branches(condition, { sort: "requested", direction: "asc" }),
    ).resolves.toMatchObject({ items: [{ branchId: "1" }, { branchId: "2" }] });
    expect(String(request.mock.calls[0][0])).toContain(
      "sort=requested&direction=asc",
    );
    comparison.items[1].branchId = "1";
    await expect(salesApi.branches(condition)).rejects.toThrow();
  });
  it("validates ledger signs, privacy, paging and refund basis", async () => {
    const response = fixture();
    const entry = {
      id: "refund-7",
      entryType: "환불",
      paymentId: "6",
      refundId: "7",
      branchId: "1",
      processingBranchId: "2",
      purpose: "이용권",
      productId: "3",
      productName: "시간권",
      categoryCode: "TIME",
      categoryName: "시간",
      passQuantity: -1,
      amountKrw: -3000,
      approvedAt: "2026-10-01T00:00:00Z",
      refundedAt: "2026-11-03T00:00:00Z",
      basisAt: "2026-11-03T00:00:00Z",
      canViewPayment: false,
    };
    const ledger = {
      aggregation: { ...response.aggregation, rowCount: 1 },
      totals: response.totals,
      meta: { page: 1, pageSize: 20, total: 1 },
      items: [entry],
    };
    request.mockResolvedValue(ledger);
    expect((await salesApi.ledger(condition)).items[0].amountKrw).toBe(-3000);
    request.mockResolvedValue({ ...ledger, items: [{ ...entry, amountKrw: -4000 }] });
    await expect(salesApi.ledger(condition)).rejects.toThrow();
    request.mockResolvedValue({
      ...ledger,
      items: [{ ...entry, customerName: "노출 금지" }],
    });
    await expect(salesApi.ledger(condition)).rejects.toThrow();
    request.mockResolvedValue({
      ...ledger,
      items: [{ ...entry, basisAt: entry.approvedAt }],
    });
    await expect(salesApi.ledger(condition)).rejects.toThrow();
    request.mockResolvedValue(ledger);
    await expect(salesApi.ledger(condition, { page: 2 })).rejects.toThrow();
  });
  it("does not convert HTTP failures or malformed successful bodies to empty results", async () => {
    request.mockRejectedValue(new Error("network"));
    await expect(salesApi.revenue(condition)).rejects.toThrow("network");
    request.mockResolvedValue({});
    await expect(salesApi.revenue(condition)).rejects.toThrow();
  });
  it("rejects changed metric units and fabricated default-period metadata", async () => {
    const response = fixture();
    response.aggregation.metrics[2].unit = "%";
    request.mockResolvedValue(response);
    await expect(salesApi.revenue(condition)).rejects.toThrow();
    const defaults = fixture();
    defaults.aggregation.condition.allBranches = true;
    defaults.aggregation.defaultPeriod = true;
    request.mockResolvedValue(defaults);
    await expect(salesApi.revenue({})).rejects.toThrow();
    request.mockResolvedValue({
      ...fixture(),
      aggregation: { ...fixture().aggregation, defaultPeriod: true },
    });
    await expect(salesApi.revenue(condition)).rejects.toThrow();
  });
});
