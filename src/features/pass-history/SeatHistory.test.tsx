import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { customerApi } from "../customers/api";
import { seatApi } from "../seats/api";
import { SeatHistory } from "./SeatHistory";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("../customers/api", () => ({ customerApi: { list: vi.fn() } }));
vi.mock("../seats/api", () => ({
  seatApi: { history: vi.fn(), board: vi.fn(), session: vi.fn() },
}));

const row = {
  id: "s1",
  branchId: "gangnam",
  status: "종료",
  customer: { id: "c1", name: "김지우", memberNo: "M-1" },
  seat: { id: "seat-1", zone: "A", seatNo: "1" },
  pass: {
    id: "p1",
    productName: "10시간권",
    purchaseBranchId: "gangnam",
  },
  checkedInAt: "2026-11-01T01:00:00Z",
  checkedOutAt: "2026-11-01T02:00:00Z",
  usedMinutes: 60,
  deductedMinutes: 60,
  deductedKrw: 0,
  overageMinutes: 0,
  overageKrw: 0,
  checkedInBy: null,
  checkInReason: null,
  moves: [],
};
let rows: (typeof row)[];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  context.value = {
    scope: "gangnam",
    session: {
      user: store.db.employees[0],
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  rows = [row];
  vi.mocked(seatApi.history).mockImplementation(
    async () =>
      ({
        items: rows,
        meta: { page: 1, pageSize: 20, total: rows.length },
      }) as never,
  );
  vi.mocked(seatApi.board).mockResolvedValue({ zones: [] } as never);
  vi.mocked(seatApi.session).mockResolvedValue(row as never);
  vi.mocked(customerApi.list).mockResolvedValue({
    items: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  } as never);
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});

function mount(search = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter([{ path: "*", element: <SeatHistory /> }], {
    initialEntries: [`/${search}`],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return () => new URLSearchParams(router.state.location.search);
}
const table = () => screen.getByRole("table", { name: "입퇴실 이력" });

it("opens the session detail from the customer name cell link", async () => {
  const params = mount();
  await userEvent.click(
    await within(table()).findByRole("button", { name: "김지우" }),
  );
  expect(params().get("detail")).toBe("s1");
  const panel = await screen.findByRole("dialog");
  expect(await within(panel).findByText("이동 이력이 없어요.")).toBeVisible();
  expect(
    screen.queryByRole("columnheader", { name: "상세" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("총 1건 · 1페이지")).toBeInTheDocument();
});

it("shows the empty state and an invalid period inside the table", async () => {
  rows = [];
  mount();
  expect(
    await within(table()).findByText("조건에 맞는 입퇴실 이력이 없어요"),
  ).toBeInTheDocument();
  cleanup();
  mount("?from=2026-11-02T00:00&to=2026-11-01T00:00");
  expect(
    within(table()).getByText("조회 종료는 시작보다 뒤여야 해요."),
  ).toBeInTheDocument();
  expect(screen.getByText("항목 수 확인 불가")).toBeInTheDocument();
  expect(seatApi.history).not.toHaveBeenCalledWith(
    expect.objectContaining({ from: expect.anything() }),
    expect.anything(),
  );
});

it("drops the page on filter changes and resets only filter keys", async () => {
  const params = mount(
    "?tab=usage&status=종료&direction=asc&from=2026-11-01T00:00&page=2&detail=s1",
  );
  // 열린 상세 패널이 배경을 가리므로 hidden 요소까지 찾고 fireEvent로 조작한다.
  await screen.findByRole("dialog");
  await screen.findByRole("button", { name: "김지우", hidden: true });
  fireEvent.change(screen.getByLabelText("이용 상태 필터"), {
    target: { value: "이용 중" },
  });
  expect(params().get("status")).toBe("이용 중");
  expect(params().has("page")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "초기화", hidden: true }));
  expect([...params().keys()].sort()).toEqual(["detail", "tab"]);
});

it("keeps the period form inline with accessible names", async () => {
  const params = mount("?tab=usage");
  await within(table()).findByRole("button", { name: "김지우" });
  const form = screen.getByRole("form", { name: "조회 기간" });
  await userEvent.type(
    within(form).getByLabelText("조회 시작 (한국 시각, 포함)"),
    "2026-11-01T09:00",
  );
  await userEvent.click(
    within(form).getByRole("button", { name: "기간 적용" }),
  );
  expect(params().get("from")).toBe("2026-11-01T09:00");
});
