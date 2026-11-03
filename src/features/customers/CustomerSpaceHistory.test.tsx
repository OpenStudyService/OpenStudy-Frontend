import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { CustomerSpaceHistory } from "./CustomerSpaceHistory";
import { getCrossBranchSummary, getSpaceHistory } from "./history-api";
import type { CrossBranchSummary } from "./history-api";
const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./history-api", async (load) => ({
  ...(await load<typeof import("./history-api")>()),
  getCrossBranchSummary: vi.fn(),
  getSpaceHistory: vi.fn(),
}));
const result: CrossBranchSummary = {
  customerId: "c1",
  passes: [
    {
      kind: "기간권",
      productName: "타 지점 기간권",
      status: "활성",
      expiresAt: null,
    },
  ],
  usages: [
    {
      kind: "사물함",
      branchId: "foreign",
      startAt: "2026-11-01T00:00:00Z",
      endAt: null,
    },
  ],
  asOf: "2026-11-03T00:00:00Z",
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  const db = new MockStore(false).db;
  context.value = {
    scope: "gangnam",
    session: {
      user: db.employees.find((u) => u.owner)!,
      branches: db.branches,
      asOf: "2026-11-03T00:00:00Z",
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getSpaceHistory).mockResolvedValue({
    customerId: "c1",
    reservations: [],
    assignments: [],
  });
  vi.mocked(getCrossBranchSummary).mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  client.clear();
});
function mount() {
  const ui = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomerSpaceHistory customerId="c1" />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, refresh: () => view.rerender(ui()) };
}
async function open() {
  await userEvent.click(
    screen.getByRole("button", { name: "타 지점 최소 요약 조회" }),
  );
}
it("requires a reason, preserves 422 input, and records each explicit successful lookup without caching its result", async () => {
  mount();
  await open();
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  expect(getCrossBranchSummary).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("응대 사유"), "타 지점 사용 확인");
  vi.mocked(getCrossBranchSummary).mockRejectedValueOnce(
    new ApiError(422, {
      code: "VALIDATION_FAILED",
      message: "사유 확인",
      fieldErrors: { reason: "응대 사유 확인" },
    }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  expect(await screen.findByText("응대 사유 확인")).toBeInTheDocument();
  expect(screen.getByLabelText("응대 사유")).toHaveValue("타 지점 사용 확인");
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  expect(
    await screen.findByRole("region", { name: "타 지점 최소 요약 결과" }),
  ).toHaveTextContent("타 지점 기간권");
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  await waitFor(() => expect(getCrossBranchSummary).toHaveBeenCalledTimes(3));
  expect(
    client
      .getQueryCache()
      .getAll()
      .some((q) =>
        JSON.stringify(q.state.data ?? null).includes("타 지점 기간권"),
      ),
  ).toBe(false);
});
it("blocks concurrent submits and ignores completion after closing the summary", async () => {
  let finish!: (v: CrossBranchSummary) => void;
  let signal!: AbortSignal;
  vi.mocked(getCrossBranchSummary).mockImplementation((_id, _body, s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  mount();
  await open();
  await userEvent.type(screen.getByLabelText("응대 사유"), "조회");
  const form = screen.getByRole("form", { name: "타 지점 최소 요약 조회" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(getCrossBranchSummary).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "닫기" }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result));
  await open();
  expect(screen.queryByText("타 지점 기간권")).not.toBeInTheDocument();
  expect(screen.getByLabelText("응대 사유")).toHaveValue("");
});
it("clears results on permission changes and hides the button from ordinary staff", async () => {
  const view = mount();
  await open();
  await userEvent.type(screen.getByLabelText("응대 사유"), "조회");
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  await screen.findByRole("region", { name: "타 지점 최소 요약 결과" });
  context.value.session.user = {
    ...context.value.session.user,
    owner: false,
    memberships: [
      { branchId: "gangnam", role: "staff", permissions: [], status: "활성" },
    ],
  };
  view.refresh();
  expect(screen.queryByText("타 지점 기간권")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /타 지점 최소 요약/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "룸·사물함 이력 보기" }),
  );
  expect(
    await screen.findByText("룸·사물함 이력이 없어요"),
  ).toBeInTheDocument();
});
it("does not automatically repeat a failed summary and revalidates the session on revoked access", async () => {
  vi.mocked(getCrossBranchSummary).mockRejectedValue(
    new ApiError(403, { code: "FORBIDDEN", message: "권한 회수" }),
  );
  const invalidate = vi.spyOn(client, "invalidateQueries");
  mount();
  await open();
  await userEvent.type(screen.getByLabelText("응대 사유"), "고객 상담");
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  expect(await screen.findByText("권한 회수")).toBeInTheDocument();
  expect(getCrossBranchSummary).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
  expect(screen.getByLabelText("응대 사유")).toHaveValue("고객 상담");
});
it("cancels a pending summary on scope change and never renders the late result", async () => {
  let finish!: (v: CrossBranchSummary) => void;
  let signal!: AbortSignal;
  vi.mocked(getCrossBranchSummary).mockImplementation((_id, _body, s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const view = mount();
  await open();
  await userEvent.type(screen.getByLabelText("응대 사유"), "조회");
  await userEvent.click(
    screen.getByRole("button", { name: "사유를 기록하고 조회" }),
  );
  context.value = { ...context.value, scope: "all" };
  view.refresh();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result));
  expect(
    screen.queryByRole("region", { name: "타 지점 최소 요약 결과" }),
  ).not.toBeInTheDocument();
  await open();
  expect(screen.getByLabelText("응대 사유")).toHaveValue("");
});
it("gates even cached fee fields and payment links on current target-branch read permission", async () => {
  const reservation = {
    id: "r1",
    version: 1,
    branchId: "gangnam",
    status: "확정" as const,
    room: { id: "room1", roomNo: "A", name: "룸" },
    customer: { id: "c1", memberNo: "C1", name: "고객" },
    startAt: "2026-11-01T00:00:00Z",
    endAt: "2026-11-01T01:00:00Z",
    billing: {
      amountKrw: 8000,
      ratePerHourKrw: 8000,
      hours: 1,
      paymentId: "p1",
      paymentStatus: "승인" as const,
    },
    usage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdBy: { id: "owner", name: "사장님" },
    createdAt: "2026-11-01T00:00:00Z",
    canCancel: false,
  };
  vi.mocked(getSpaceHistory).mockResolvedValue({
    customerId: "c1",
    reservations: [reservation],
    assignments: [],
  });
  const view = mount();
  await userEvent.click(
    screen.getByRole("button", { name: "룸·사물함 이력 보기" }),
  );
  expect(
    await screen.findByRole("link", { name: "관련 결제 상세" }),
  ).toHaveAttribute("href", "/app/gangnam/payments?detail=p1");
  expect(screen.getByRole("link", { name: "룸 예약 상세" })).toHaveAttribute(
    "href",
    "/app/gangnam/reservations?detail=r1",
  );
  context.value.session.user = {
    ...context.value.session.user,
    owner: false,
    memberships: [
      {
        branchId: "gangnam",
        role: "staff",
        permissions: ["payments:write"],
        status: "활성",
      },
    ],
  };
  view.refresh();
  await userEvent.click(
    screen.getByRole("button", { name: "룸·사물함 이력 보기" }),
  );
  await screen.findByRole("link", { name: "룸 예약 상세" });
  expect(
    screen.queryByRole("link", { name: "관련 결제 상세" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/8,000/)).not.toBeInTheDocument();
});
