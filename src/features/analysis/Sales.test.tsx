import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { Sales } from "./Sales";
import type { CurrentUser } from "../../shared/domain/schema";
import type {
  RevenueSummary,
  BranchRevenueComparison,
  SalesLedgerPage,
} from "./sales-api";

const mocks = vi.hoisted(() => ({
  revenue: vi.fn(),
  branches: vi.fn(),
  ledger: vi.fn(),
  volume: vi.fn(),
  products: vi.fn(),
  trend: vi.fn(),
  context: {} as { session: CurrentUser; scope: string },
}));
vi.mock("../../app/context", () => ({ useApp: () => mocks.context }));
vi.mock("./sales-api", async (load) => {
  const actual = await load<typeof import("./sales-api")>();
  return {
    ...actual,
    salesApi: {
      revenue: mocks.revenue,
      branches: mocks.branches,
      ledger: mocks.ledger,
      volume: mocks.volume,
      products: mocks.products,
      trend: mocks.trend,
    },
  };
});
vi.mock("./Charts", () => ({ SalesChart: () => <p>순매출 차트</p> }));
const totals = {
  approvedAmountKrw: 1000,
  refundAmountKrw: 1000,
  netAmountKrw: 0,
  approvedPaymentCount: 1,
  refundCount: 1,
  dataStatus: "hasData" as const,
};
const aggregation: RevenueSummary["aggregation"] = {
  condition: {
    branchIds: ["1"],
    allBranches: true,
    from: "2026-10-31T15:00:00Z",
    to: "2026-11-06T15:00:00Z",
    refundBasis: "processedDate",
    purpose: null,
    productId: null,
    categoryCode: null,
    methods: [],
    productKinds: [],
    operatorIds: [],
    processingBranchIds: [],
    granularity: null,
  },
  defaultPeriod: true,
  conditionNotes: [],
  timeZone: "Asia/Seoul",
  currency: "KRW",
  asOf: "2026-11-06T05:00:00Z",
  rowCount: 3,
  sourceRowCount: 2,
  dataStatus: "hasData",
  partial: {
    periodOpen: true,
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
};
const revenue: RevenueSummary = {
  aggregation,
  totals,
  byPurpose: [{ ...totals, purpose: "이용권" }],
};
const branches: BranchRevenueComparison = {
  aggregation,
  totals,
  items: [
    {
      ...totals,
      branchId: "1",
      branchName: "강남점",
      byPurpose: revenue.byPurpose,
    },
  ],
};
const ledger: SalesLedgerPage = {
  aggregation,
  totals,
  meta: { page: 1, pageSize: 20, total: 2 },
  items: [
    {
      id: "payment-1",
      entryType: "승인",
      paymentId: "1",
      refundId: null,
      branchId: "1",
      processingBranchId: null,
      purpose: "이용권",
      productId: "1",
      productName: "첫 구매 상품",
      categoryCode: "TIME",
      categoryName: "시간",
      passQuantity: 1,
      amountKrw: 1000,
      approvedAt: "2026-11-01T00:00:00Z",
      refundedAt: null,
      basisAt: "2026-11-01T00:00:00Z",
      canViewPayment: true,
    },
  ],
};
const session = {
  user: {
    id: "10",
    branchId: "1",
    owner: false,
    status: "활성",
    memberships: [
      { branchId: "1", role: "staff", permissions: ["sales:read"], version: 1 },
    ],
    version: 1,
    name: "직원",
  },
  branches: [
    { id: "1", name: "강남점" },
    { id: "2", name: "홍대점" },
  ],
  asOf: "2026-11-06T05:00:00Z",
} as CurrentUser;
let client: QueryClient;
beforeEach(() => {
  mocks.context = { session, scope: "all" };
  mocks.revenue.mockResolvedValue(revenue);
  mocks.branches.mockResolvedValue(branches);
  mocks.ledger.mockResolvedValue(ledger);
  mocks.volume.mockImplementation(() => new Promise(() => undefined));
  mocks.products.mockImplementation(() => new Promise(() => undefined));
  mocks.trend.mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
function Location() {
  return <output aria-label="주소 조건">{useLocation().search}</output>;
}
function show(search = "") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/all/sales${search}`]}>
        <Sales />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("uses server default period and renders actual zero with transaction state and metadata", async () => {
  show();
  const summary = await screen.findByRole("region", { name: "매출 요약" });
  await waitFor(() =>
    expect(within(summary).getByText("용도별 매출")).toBeVisible(),
  );
  expect(mocks.revenue.mock.calls[0][0]).toEqual({
    refundBasis: "processedDate",
  });
  expect(within(summary).getAllByText("0원").length).toBeGreaterThan(0);
  expect(within(summary).queryByText("거래 없음")).not.toBeInTheDocument();
  expect(within(summary).getByText(/이번 달 기본 기간/)).toBeVisible();
  expect(screen.getAllByText(/기준 시각:/)).toHaveLength(3);
  expect(screen.getByRole("checkbox", { name: "강남점" })).toBeVisible();
  expect(
    screen.queryByRole("checkbox", { name: "홍대점" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "결제 보기" }),
  ).not.toBeInTheDocument();
});
it("does not fetch dates outside the 366-day limit or one-sided period", async () => {
  show("?from=2025-01-01&to=2026-01-03");
  expect(
    screen.getByRole("heading", { name: "조회 조건을 확인해 주세요" }),
  ).toBeVisible();
  expect(mocks.revenue).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("종료일 (미포함)"));
  expect(mocks.revenue).not.toHaveBeenCalled();
});
it.each(["?branchIds=2", "?branchIds=1&branchIds=1"])(
  "blocks unauthorized or duplicate branch selections: %s",
  (search) => {
    show(search);
    expect(
      screen.getByText("선택한 지점의 매출 조회 권한을 확인해 주세요."),
    ).toBeVisible();
    expect(mocks.revenue).not.toHaveBeenCalled();
  },
);

it("does not fetch for an inactive owner", () => {
  mocks.context.session = {
    ...session,
    user: { ...session.user, owner: true, status: "비활성" },
  };
  show();
  expect(
    screen.getByRole("heading", { name: "매출 조회 권한이 필요해요" }),
  ).toBeVisible();
  expect(mocks.revenue).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /CSV 다운로드|PNG 저장/ }),
  ).not.toBeInTheDocument();
});
it("keeps branch, purpose and refund conditions in URL and resets ledger page on filter changes", async () => {
  show("?branchIds=1&ledgerPage=3");
  await screen.findByText("용도별 매출");
  await userEvent.selectOptions(screen.getByLabelText("결제 용도"), "사물함");
  await waitFor(() =>
    expect(screen.getByLabelText("주소 조건")).toHaveTextContent("purpose="),
  );
  expect(screen.getByLabelText("주소 조건")).not.toHaveTextContent(
    "ledgerPage",
  );
  expect(mocks.revenue.mock.calls.at(-1)?.[0]).toEqual({
    branchIds: ["1"],
    refundBasis: "processedDate",
    purpose: "사물함",
  });
});
it("warns before downloading ledger and product reports using their total row counts", async () => {
  mocks.ledger.mockResolvedValue({
    ...ledger,
    meta: { ...ledger.meta, total: 1_001 },
  });
  mocks.products.mockResolvedValue({
    aggregation,
    items: [],
    meta: { page: 1, pageSize: 20, total: 1_002 },
  });
  show();
  expect(
    await screen.findByRole("button", { name: "매출 원장 CSV 다운로드" }),
  ).toHaveAccessibleDescription("CSV에는 앞의 1,000행만 담겨요.");
  expect(
    await screen.findByRole("button", {
      name: "이용권 상품별 판매 CSV 다운로드",
    }),
  ).toHaveAccessibleDescription("CSV에는 앞의 1,000행만 담겨요.");
});

it("uses scope as an explicit branch and never displays a private payment link from stale server hints", async () => {
  mocks.context.scope = "1";
  show();
  await screen.findByText("첫 구매 상품", { exact: false });
  expect(mocks.revenue.mock.calls[0][0]).toEqual({
    branchIds: ["1"],
    refundBasis: "processedDate",
  });
  expect(
    screen.queryByRole("link", { name: "결제 보기" }),
  ).not.toBeInTheDocument();
});
it("shows payment navigation only when server hint and current payment permission agree", async () => {
  mocks.context.session = {
    ...session,
    user: { ...session.user, owner: true },
  };
  show();
  expect(
    await screen.findByRole("link", { name: "결제 보기" }),
  ).toHaveAttribute("href", "/app/1/payments?detail=1");
});
it("distinguishes empty results from an actual zero and avoids an empty chart", async () => {
  const zero = {
    approvedAmountKrw: 0,
    refundAmountKrw: 0,
    netAmountKrw: 0,
    approvedPaymentCount: 0,
    refundCount: 0,
    dataStatus: "noData" as const,
  };
  const emptyMeta = {
    ...aggregation,
    dataStatus: "noData" as const,
    sourceRowCount: 0,
  };
  mocks.revenue.mockResolvedValue({
    ...revenue,
    aggregation: emptyMeta,
    totals: zero,
    byPurpose: [{ ...zero, purpose: "이용권" }],
  });
  mocks.branches.mockResolvedValue({
    ...branches,
    aggregation: emptyMeta,
    totals: zero,
    items: [{ ...branches.items[0], ...zero }],
  });
  mocks.ledger.mockResolvedValue({
    ...ledger,
    aggregation: emptyMeta,
    totals: zero,
    items: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  show();
  expect(
    await screen.findByRole("heading", {
      name: "조회 조건에 맞는 거래가 없어요",
    }),
  ).toBeVisible();
  expect(screen.getAllByText("거래 없음").length).toBeGreaterThan(0);
  expect(screen.queryByText("순매출 차트")).not.toBeInTheDocument();
});
it("shows a failed response as an error without fabricated amount cards", async () => {
  mocks.revenue.mockRejectedValue(new Error("서버 연결 실패"));
  show();
  const summary = screen.getByRole("region", { name: "매출 요약" });
  expect(await within(summary).findByText("서버 연결 실패")).toBeVisible();
  expect(within(summary).queryByText("승인 결제액")).not.toBeInTheDocument();
});

it("does not restore private amounts when a response arrives after permission loss", async () => {
  let finish!: (value: RevenueSummary) => void;
  mocks.revenue.mockReturnValue(
    new Promise<RevenueSummary>((resolve) => {
      finish = resolve;
    }),
  );
  const view = show();
  await waitFor(() => expect(mocks.revenue).toHaveBeenCalledTimes(1));
  mocks.context.session = {
    ...session,
    user: { ...session.user, memberships: [] },
  };
  view.rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/all/sales"]}>
        <Sales />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("heading", { name: "매출 조회 권한이 필요해요" }),
  ).toBeVisible();
  finish(revenue);
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "매출 요약" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("1,000원")).not.toBeInTheDocument();
});

it("does not show the previous account's cached amounts while a new account is loading", async () => {
  const view = show();
  await screen.findByText("용도별 매출");
  mocks.revenue.mockReturnValue(new Promise<RevenueSummary>(() => undefined));
  mocks.branches.mockReturnValue(
    new Promise<BranchRevenueComparison>(() => undefined),
  );
  mocks.ledger.mockReturnValue(new Promise<SalesLedgerPage>(() => undefined));
  mocks.context.session = { ...session, user: { ...session.user, id: "11" } };
  view.rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/all/sales"]}>
        <Sales />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("용도별 매출")).not.toBeInTheDocument();
  expect(screen.queryByText("1,000원")).not.toBeInTheDocument();
  for (const name of ["매출 요약", "지점별 매출 비교", "매출 최소 원장"])
    expect(
      within(screen.getByRole("region", { name })).getByRole("status"),
    ).toBeVisible();
});
