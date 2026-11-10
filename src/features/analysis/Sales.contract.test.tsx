import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { setupServer } from "msw/node";
import { createAppQueryClient } from "../../app/queryClient";
import { salesHandlers } from "../../mocks/sales";
import { dailyClosingHandlers } from "../../mocks/daily-closings";
import { store } from "../../mocks/store";
import { formatDateTime } from "../../shared/domain/format";
import { Sales } from "./Sales";

vi.mock("../../shared/api/client", async (load) => ({
  ...(await load<typeof import("../../shared/api/client")>()),
  MOCK: true,
}));
vi.mock("../../app/context", () => ({
  useApp: () => ({
    session: {
      user: store.activeUser(),
      branches: store.db.branches,
      asOf: store.now(),
    },
    scope: "all",
  }),
}));
vi.mock("./Charts", () => ({
  SalesChart: () => <div role="img" aria-label="지점별 순매출 차트" />,
  SalesTrendChart: ({ label }: { label: string }) => (
    <div role="img" aria-label={`${label} 추세 차트`} />
  ),
}));

const server = setupServer(...salesHandlers, ...dailyClosingHandlers);
const requests: URL[] = [];
const asOf = "2026-11-10T03:00:00.000Z";
const client = createAppQueryClient();

beforeAll(() => {
  server.listen();
  server.events.on("request:start", ({ request }) =>
    requests.push(new URL(request.url)),
  );
});
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
  vi.spyOn(store, "now").mockReturnValue(asOf);
});
afterEach(() => {
  cleanup();
  client.clear();
  requests.length = 0;
  vi.restoreAllMocks();
});

function show(search: string) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/all/sales${search}`]}>
        <Sales />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const september = "?from=2026-09-01&to=2026-10-01";
const region = (name: string) => within(screen.getByRole("region", { name }));

it("displays validated response metadata with all cards, tables and charts", async () => {
  show(september);
  await screen.findByRole("img", { name: "순판매량 추세 차트" });
  for (const name of [
    "매출 요약",
    "지점별 매출 비교",
    "매출 최소 원장",
    "이용권 판매량",
    "상품 판매 순위",
    "매출 추세",
    "이용권 판매량 추세",
  ]) {
    const result = region(name);
    expect(await result.findByText(/기준 시각:/)).toHaveTextContent(
      `Asia/Seoul · KRW`,
    );
    expect(result.getByText(/기준 시각:/)).toHaveTextContent(
      formatDateTime(asOf),
    );
    expect(result.getByText(/적용 기간:/)).toHaveTextContent(
      formatDateTime("2026-08-31T15:00:00Z"),
    );
    expect(result.getByText(/적용 기간:/)).toHaveTextContent(
      formatDateTime("2026-09-30T15:00:00Z"),
    );
    expect(result.getByText(/적용 지점:/)).toHaveTextContent(
      "환불 처리일 기준",
    );
  }
  expect(region("상품 판매 순위").getByRole("table")).toBeVisible();
  expect(region("매출 추세").getByRole("img")).toBeVisible();
  expect(requests).toHaveLength(7);
  await userEvent.selectOptions(
    screen.getByLabelText("환불 집계 기준"),
    "paymentDate",
  );
  await waitFor(() => expect(requests).toHaveLength(14));
  expect(
    requests
      .slice(7)
      .every(
        (url) =>
          url.searchParams.get("refundBasis") === "paymentDate" &&
          url.searchParams.get("from") === "2026-08-31T15:00:00.000Z",
      ),
  ).toBe(true);
  expect(
    client
      .getQueryCache()
      .findAll({ queryKey: ["data"] })
      .some(({ queryKey }) =>
        queryKey.includes(
          JSON.stringify({
            from: "2026-08-31T15:00:00.000Z",
            to: "2026-09-30T15:00:00.000Z",
            refundBasis: "paymentDate",
          }),
        ),
      ),
  ).toBe(true);
});

it("shows applied advanced filter and server note on the card, ledger and trend", async () => {
  show(`${september}&methods=${encodeURIComponent("카드")}`);
  for (const name of ["매출 요약", "매출 최소 원장", "매출 추세"]) {
    const result = await screen.findByRole("region", { name });
    expect(
      await within(result).findByText("환불은 원결제 수단으로 나눴다"),
    ).toBeVisible();
    expect(within(result).getByText("카드")).toBeVisible();
  }
  expect(
    requests
      .filter((url) => url.pathname.includes("/sales/"))
      .every((url) => url.searchParams.getAll("methods").join() === "카드"),
  ).toBe(true);
});

it("renders the amounts and refund actor in closing detail", async () => {
  const approved = store.db.payments.find(
    (p) => p.productId && p.status === "승인",
  )!;
  approved.approvedAt = "2026-11-09T03:00:00.000Z";
  const response = await fetch("/api/daily-closings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": "openstudy-mock-csrf",
    },
    body: JSON.stringify({
      branchId: approved.branchId,
      businessDate: "2026-11-09",
    }),
  });
  expect(response.status).toBe(201);
  approved.status = "환불";
  approved.refundAt = "2026-11-10T03:00:01.000Z";
  approved.refundBranchId = approved.branchId;
  approved.reason = "조정 사유 테스트";
  vi.mocked(store.now).mockReturnValue("2026-11-10T04:00:00.000Z");
  show("");
  await userEvent.click(screen.getByRole("button", { name: "일별 마감" }));
  await userEvent.click(
    await screen.findByRole("button", { name: /2026-11-09.*상세/ }),
  );
  const detail = within(
    await screen.findByRole("region", { name: "마감 상세" }),
  );
  expect(
    detail.getByRole("rowheader", { name: "마감 금액 (원결제일)" }),
  ).toBeVisible();
  expect(
    detail.getByRole("rowheader", { name: "조정 합계 (원결제일)" }),
  ).toBeVisible();
  expect(
    detail.getByRole("rowheader", { name: "현재 금액 (원결제일)" }),
  ).toBeVisible();
  expect(
    detail.getByRole("row", { name: /조정 사유 테스트.*김서연/ }),
  ).toBeVisible();
});

it("sends the product page and both trend measures but omits the fixed pass purpose", async () => {
  show(
    `${september}&productPage=2&granularity=week&purpose=${encodeURIComponent("이용권")}`,
  );
  await region("상품 판매 순위").findByText("이 페이지에 상품이 없어요");
  await waitFor(() => expect(requests).toHaveLength(7));
  const product = requests.find((url) =>
    url.pathname.endsWith("/passes/products"),
  );
  expect(product?.searchParams.get("page")).toBe("2");
  expect(product?.searchParams.has("purpose")).toBe(false);
  const trends = requests.filter((url) => url.pathname.endsWith("/trend"));
  expect(trends.map((url) => url.searchParams.get("measure")).sort()).toEqual([
    "passes",
    "revenue",
  ]);
  expect(
    trends.every((url) => url.searchParams.get("granularity") === "week"),
  ).toBe(true);
  expect(
    trends
      .find((url) => url.searchParams.get("measure") === "revenue")
      ?.searchParams.get("purpose"),
  ).toBe("이용권");
  expect(
    trends
      .find((url) => url.searchParams.get("measure") === "passes")
      ?.searchParams.has("purpose"),
  ).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("결제 용도"), "스터디룸");
  expect(screen.getByText("이용권 판매 지표 · 해당 없음")).toBeVisible();
  await waitFor(() => expect(requests).toHaveLength(11));
  expect(
    requests
      .slice(7)
      .every((url) => url.searchParams.get("purpose") === "스터디룸"),
  ).toBe(true);
});

it("shows an empty result, then clears it when a manual refresh receives 403", async () => {
  store.scenario = "empty";
  show("");
  expect(
    await screen.findByText("조회 조건에 맞는 상품 판매가 없어요"),
  ).toBeVisible();
  expect(screen.getByLabelText("적용된 기본 날짜")).toHaveTextContent(
    "2026-11-01 ~ 2026-11-11",
  );
  expect(region("매출 요약").getAllByText("0원").length).toBeGreaterThan(0);
  store.scenario = "forbidden";
  await userEvent.click(screen.getByRole("button", { name: "새로고침" }));
  expect(
    await screen.findByRole("heading", { name: "매출 조회 권한이 필요해요" }),
  ).toBeVisible();
  expect(
    screen.queryByText("조회 조건에 맞는 상품 판매가 없어요"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("0원")).not.toBeInTheDocument();
});
