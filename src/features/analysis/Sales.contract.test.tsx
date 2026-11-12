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
  act,
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

it("exports each report with its screen query and the server filename", async () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = vi.fn().mockReturnValue("blob:csv");
      static revokeObjectURL = vi.fn();
    },
  );
  try {
    show(
      `${september}&branchIds=gangnam&branchIds=seongsu&refundBasis=paymentDate&methods=카드&methods=현금&productKinds=시간권&sort=branchId&direction=asc&entryType=환불&ledgerDirection=asc&ledgerPage=2&productPage=2&granularity=week`,
    );
    const reports = [
      ["요약", "매출 요약", "revenue", "revenue"],
      ["요약", "지점별 매출 비교", "revenue-branches", "revenue/branches"],
      ["원장", "매출 원장", "ledger", "ledger"],
      ["판매 분석", "이용권 판매량", "passes-volume", "passes/volume"],
      ["판매 분석", "이용권 상품별 판매", "passes-products", "passes/products"],
      ["이용권 사용량", "이용권 사용 현황", "passes-usage", "passes/usage"],
      ["추세", "매출 추세", "trend", "trend", "revenue"],
      ["추세", "이용권 판매량 추세", "trend", "trend", "passes"],
    ];
    for (const [tab, title, report, screenPath, measure] of reports) {
      const trigger = screen.getByRole("tab", { name: tab });
      if (trigger.getAttribute("aria-selected") !== "true")
        await userEvent.click(trigger);
      const button = await screen.findByRole("button", {
        name: `${title} CSV 다운로드`,
      });
      await userEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      const exported = requests.find(
        (url) =>
          url.pathname === `/api/sales/exports/${report}` &&
          (!measure || url.searchParams.get("measure") === measure),
      );
      const read = requests.find(
        (url) =>
          url.pathname === `/api/sales/${screenPath}` &&
          (!measure || url.searchParams.get("measure") === measure),
      );
      expect(exported).toBeDefined();
      expect(read).toBeDefined();
      const readQuery = new OriginalURL(read!.href).searchParams;
      readQuery.delete("page");
      readQuery.delete("pageSize");
      readQuery.sort();
      const exportQuery = exported!.searchParams;
      exportQuery.sort();
      expect([...exportQuery]).toEqual([...readQuery]);
    }
    expect(click).toHaveBeenCalledTimes(reports.length);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(
      /^매출 요약_\d{8}-\d{4}\.csv$/,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

const region = (name: string) => within(screen.getByRole("region", { name }));
const selectTab = (name: string) =>
  userEvent.click(screen.getByRole("tab", { name }));

it("displays validated response metadata with all cards, tables and charts", async () => {
  show(september);
  for (const [tab, name] of [
    ["요약", "매출 요약"],
    ["요약", "지점별 매출 비교"],
    ["원장", "매출 최소 원장"],
    ["판매 분석", "이용권 판매량"],
    ["판매 분석", "상품 판매 순위"],
    ["추세", "매출 추세"],
    ["추세", "이용권 판매량 추세"],
  ]) {
    await selectTab(tab);
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
    if (name === "상품 판매 순위")
      expect(result.getByRole("table")).toBeVisible();
    if (tab === "추세") expect(result.getByRole("img")).toBeVisible();
  }
  expect(requests).toHaveLength(7);
  await userEvent.selectOptions(
    screen.getByLabelText("환불 집계 기준"),
    "paymentDate",
  );
  await waitFor(() => expect(requests).toHaveLength(9));
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
  for (const [tab, name] of [
    ["요약", "매출 요약"],
    ["원장", "매출 최소 원장"],
    ["추세", "매출 추세"],
  ]) {
    await selectTab(tab);
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

it("opens usage by URL and queries only its applicable filters", async () => {
  show(
    "?view=pass-usage&branchIds=gangnam&productKinds=시간권&categoryCode=TIME&refundBasis=paymentDate&purpose=사물함&methods=카드&ledgerPage=2",
  );
  expect(
    screen.getByRole("tab", { name: "이용권 사용량", selected: true }),
  ).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "이용 지점별 이용권 사용량" }),
  ).toBeVisible();
  const filters = region("이용권 사용량 조회 조건");
  expect(filters.getByLabelText("시작일")).toHaveValue("");
  expect(filters.getByRole("group", { name: "이용 지점" })).toBeVisible();
  const kinds = filters.getByRole("button", { name: "상품 유형, 시간권" });
  expect(kinds).toBeVisible();
  expect(filters.getByLabelText("상품 분류 코드")).toHaveValue("TIME");
  expect(filters.queryByText("고급 필터")).not.toBeInTheDocument();
  expect(filters.queryByLabelText("환불 집계 기준")).not.toBeInTheDocument();
  expect(filters.queryByLabelText("결제 용도")).not.toBeInTheDocument();
  expect(requests.map((url) => url.pathname)).toEqual([
    "/api/sales/passes/usage",
  ]);
  const query = new URLSearchParams(requests[0].search);
  expect(query.getAll("branchIds")).toEqual(["gangnam"]);
  expect(query.getAll("productKinds")).toEqual(["시간권"]);
  expect(query.get("categoryCode")).toBe("TIME");
  for (const key of ["refundBasis", "purpose", "methods", "ledgerPage"])
    expect(query.has(key)).toBe(false);

  await userEvent.click(kinds);
  const options = screen.getByRole("dialog", { name: "상품 유형" });
  expect(
    within(options).getByRole("checkbox", { name: "시간권" }),
  ).toBeChecked();
  await userEvent.click(
    within(options).getByRole("checkbox", { name: "기간권" }),
  );
  await waitFor(() =>
    expect(requests.at(-1)?.searchParams.getAll("productKinds")).toEqual([
      "시간권",
      "기간권",
    ]),
  );
  await userEvent.keyboard("{Escape}");
  await selectTab("원장");
  expect(screen.getByLabelText("환불 집계 기준")).toHaveValue("paymentDate");
  expect(screen.getByLabelText("결제 용도")).toHaveValue("사물함");
  const advancedToggle = screen.getByRole("button", { name: /^고급 필터/ });
  expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(advancedToggle);
  const advanced = screen.getByRole("region", { name: "매출 고급 필터" });
  expect(
    within(advanced).getByRole("button", { name: "상품 유형, 2개 선택" }),
  ).toBeVisible();
  await userEvent.click(
    within(advanced).getByRole("button", { name: "결제 수단, 카드" }),
  );
  const methods = within(screen.getByRole("dialog", { name: "결제 수단" }));
  expect(methods.getByRole("checkbox", { name: "카드" })).toBeChecked();
  await userEvent.click(methods.getByRole("checkbox", { name: "현금" }));
  expect(methods.getByRole("checkbox", { name: "카드" })).toBeChecked();
  expect(methods.getByRole("checkbox", { name: "현금" })).toBeChecked();
  await waitFor(() =>
    expect(
      requests.some(
        (url) =>
          url.pathname === "/api/sales/ledger" &&
          url.searchParams.getAll("methods").join(",") === "카드,현금",
      ),
    ).toBe(true),
  );
  await userEvent.keyboard("{Escape}");

  await userEvent.click(
    within(advanced).getByRole("button", { name: "환불 처리 지점, 전체" }),
  );
  const branches = within(
    screen.getByRole("dialog", { name: "환불 처리 지점" }),
  );
  await userEvent.click(branches.getByRole("checkbox", { name: "강남점" }));
  await userEvent.click(branches.getByRole("checkbox", { name: "성수점" }));
  expect(branches.getByRole("checkbox", { name: "강남점" })).toBeChecked();
  expect(branches.getByRole("checkbox", { name: "성수점" })).toBeChecked();
  await waitFor(() =>
    expect(
      requests.some(
        (url) =>
          url.pathname === "/api/sales/ledger" &&
          url.searchParams.getAll("processingBranchIds").join(",") ===
            "gangnam,seongsu",
      ),
    ).toBe(true),
  );
  await userEvent.keyboard("{Escape}");
  expect(advanced).toBeVisible();
  await userEvent.click(advancedToggle);
  expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
  expect(advancedToggle).toHaveTextContent("4개 적용");
  expect(advanced).not.toBeVisible();
});

it("shows the sales validation only on the views that use those conditions", async () => {
  show("?view=pass-usage&from=2026-09-01&refundBasis=invalid");
  expect(
    screen.getByRole("heading", { name: "조회 조건을 확인해 주세요" }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "조건 초기화" }));
  expect(
    await screen.findByRole("heading", { name: "이용 지점별 이용권 사용량" }),
  ).toBeVisible();
  await selectTab("원장");
  expect(
    screen.getByRole("heading", { name: "조회 조건을 확인해 주세요" }),
  ).toBeVisible();
  expect(
    requests.every((url) => url.pathname === "/api/sales/passes/usage"),
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
  requests.length = 0;
  show("?view=daily-closings&from=2026-11-01&ledgerPage=invalid");
  expect(
    screen.getByRole("tab", { name: "일별 마감", selected: true }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "매출 조회 조건" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "조회 조건을 확인해 주세요" }),
  ).not.toBeInTheDocument();
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
  expect(requests.map((url) => url.pathname)).toEqual([
    "/api/daily-closings",
    expect.stringMatching(/^\/api\/daily-closings\/[^/]+$/),
  ]);
});

it("sends the product page and both trend measures but omits the fixed pass purpose", async () => {
  show(
    `${september}&view=sales&productPage=2&granularity=week&purpose=${encodeURIComponent("이용권")}`,
  );
  await region("상품 판매 순위").findByText("이 페이지에 상품이 없어요");
  expect(requests).toHaveLength(2);
  await selectTab("추세");
  await waitFor(() => expect(requests).toHaveLength(4));
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
  expect(screen.getByText("이용권 판매량 추세 · 해당 없음")).toBeVisible();
  await waitFor(() => expect(requests).toHaveLength(5));
  await selectTab("판매 분석");
  expect(screen.getByText("이용권 판매 지표 · 해당 없음")).toBeVisible();
  expect(requests).toHaveLength(5);
  expect(
    requests
      .slice(4)
      .every((url) => url.searchParams.get("purpose") === "스터디룸"),
  ).toBe(true);
});

it("shows an empty result, then clears it when a manual refresh receives 403", async () => {
  store.scenario = "empty";
  show("?view=sales");
  expect(
    await screen.findByText("조회 조건에 맞는 상품 판매가 없어요"),
  ).toBeVisible();
  expect(await screen.findByLabelText("적용된 기본 날짜")).toHaveTextContent(
    "2026-11-01 ~ 2026-11-11",
  );
  store.scenario = "forbidden";
  await act(() =>
    client.refetchQueries({
      queryKey: ["data", store.activeUser().id],
      type: "active",
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "매출 조회 권한이 필요해요" }),
  ).toBeVisible();
  expect(
    screen.queryByText("조회 조건에 맞는 상품 판매가 없어요"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("0원")).not.toBeInTheDocument();
});
