import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { seatApi } from "./api";
import type { Seat, SeatBoard, SeatSession } from "./model";
import { Seats } from "./Seats";

const app = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => app.value }));
vi.mock("./api", () => ({
  seatApi: {
    board: vi.fn(),
    occupancy: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    status: vi.fn(),
    lookup: vi.fn(),
    session: vi.fn(),
    checkIn: vi.fn(),
    checkOut: vi.fn(),
    move: vi.fn(),
  },
}));
let seat: Seat;
let usage: SeatSession;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  const store = new MockStore(false);
  app.value = {
    scope: "gangnam",
    session: {
      user: store.db.employees.find((e) => e.id === "owner")!,
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  seat = {
    id: "s1",
    version: 1,
    branchId: "gangnam",
    zone: "집중존",
    seatNo: "A-01",
    kind: "일반",
    status: "사용 가능",
    activeSession: null,
    createdAt: "2026-11-02T00:00:00Z",
  };
  usage = {
    id: "u1",
    version: 1,
    branchId: "gangnam",
    status: "이용 중",
    seat: { id: "s1", zone: "집중존", seatNo: "A-01" },
    customer: { id: "external-customer", name: "홍길동", memberNo: "C001" },
    pass: {
      id: "p1",
      kind: "시간권",
      productName: "600분권",
      purchaseBranchId: "other",
    },
    checkedInAt: "2026-11-02T00:00:00Z",
    checkedOutAt: null,
    usedMinutes: 0,
    deductedMinutes: 0,
    deductedKrw: 0,
    overageMinutes: 0,
    overageKrw: 0,
    passRemainingMinutes: 600,
    passRemainingCreditKrw: null,
    checkedInBy: null,
    checkInReason: null,
    moves: [],
  };
  vi.mocked(seatApi.board).mockImplementation(async () => board());
  vi.mocked(seatApi.detail).mockImplementation(async () => ({ ...seat }));
  vi.mocked(seatApi.session).mockImplementation(async () => ({ ...usage }));
  vi.mocked(seatApi.occupancy).mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clients.forEach((c) => c.clear());
  clients.length = 0;
});
function board(): SeatBoard {
  return {
    zones: [{ zone: seat.zone, seats: [{ ...seat }] }],
    counts: {
      branchId: seat.branchId,
      total: 1,
      inUse: seat.status === "사용 중" ? 1 : 0,
      available: seat.status === "사용 가능" ? 1 : 0,
      blocked: seat.status === "운영 중단" ? 1 : 0,
      occupancyRate: seat.status === "사용 중" ? 100 : 0,
      asOf: "2026-11-02T02:03:00Z",
    },
  };
}
function show(url = "/spaces") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter([{ path: "/spaces", element: <Seats /> }], {
          initialEntries: [url],
        })}
      />
    </QueryClientProvider>,
  );
}
async function open() {
  await userEvent.click(
    await screen.findByRole("button", { name: "A-01 일반 사용 가능" }),
  );
  return screen.findByRole("dialog");
}

it("uses board counts and server asOf, and scopes the type request", async () => {
  show();
  await screen.findByRole("button", { name: "A-01 일반 사용 가능" });
  expect(screen.getByLabelText("좌석 현황")).toHaveTextContent("0.0%");
  expect(screen.getByText(/기준 시점:/)).toHaveTextContent("11:03");
  await userEvent.selectOptions(
    screen.getByLabelText("좌석 유형 필터"),
    "모니터",
  );
  await waitFor(() =>
    expect(seatApi.board).toHaveBeenLastCalledWith(
      "gangnam",
      "모니터",
      expect.any(AbortSignal),
    ),
  );
  expect(seatApi.occupancy).not.toHaveBeenCalled();
});

it("allows active staff check-in without granting seat settings or move rights", async () => {
  app.value.session.user = {
    ...app.value.session.user,
    owner: false,
    memberships: [
      { branchId: "gangnam", role: "staff", status: "활성", permissions: [] },
    ],
  };
  show();
  const dialog = await open();
  expect(
    screen.queryByRole("button", { name: "좌석 등록" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "좌석 수정" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "운영 중단" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "직원 예외 입실" }),
  ).toBeInTheDocument();
});

it("creates with canonical seat fields and retries an uncertain response with the same key", async () => {
  vi.mocked(seatApi.create)
    .mockRejectedValueOnce(new Error("연결이 끊겼어요"))
    .mockResolvedValue(seat);
  show();
  await userEvent.click(
    await screen.findByRole("button", { name: "좌석 등록" }),
  );
  await userEvent.type(screen.getByLabelText("구역"), " 집중존 ");
  await userEvent.type(screen.getByLabelText("좌석 번호"), "A-02");
  await userEvent.click(screen.getByRole("button", { name: "좌석 등록 완료" }));
  await screen.findByText("연결이 끊겼어요");
  await userEvent.click(screen.getByRole("button", { name: "좌석 등록 완료" }));
  await waitFor(() => expect(seatApi.create).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(seatApi.create).mock.calls;
  expect(calls[0][1]).toEqual({
    branchId: "gangnam",
    zone: "집중존",
    seatNo: "A-02",
    kind: "일반",
    status: "사용 가능",
  });
  expect(calls[0][3]).toBe(calls[1][3]);
});

it("retains a conflicted edit and applies only the explicitly refreshed version", async () => {
  vi.mocked(seatApi.update)
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "VERSION_CONFLICT",
        message: "다른 직원이 수정했어요",
      }),
    )
    .mockResolvedValue(seat);
  show();
  await open();
  await userEvent.click(screen.getByRole("button", { name: "좌석 수정" }));
  const input = screen.getByLabelText("좌석 번호");
  await userEvent.clear(input);
  await userEvent.type(input, "A-99");
  seat = { ...seat, version: 2, seatNo: "A-03" };
  await userEvent.click(screen.getByRole("button", { name: "변경 저장" }));
  await screen.findByText("다른 직원이 수정했어요");
  expect(input).toHaveValue("A-99");
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  await screen.findByText(/최신 서버 내용: 집중존 · A-03/);
  await userEvent.click(screen.getByRole("button", { name: "변경 저장" }));
  await waitFor(() => expect(seatApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(seatApi.update).mock.calls[0][2]).toEqual({
    version: 1,
    zone: "집중존",
    seatNo: "A-99",
    kind: "일반",
  });
  expect(vi.mocked(seatApi.update).mock.calls[1][2]).toEqual({
    version: 2,
    zone: "집중존",
    seatNo: "A-99",
    kind: "일반",
  });
});

it("uses exact lookup candidates and usable passes for cross-branch customer check-in", async () => {
  vi.mocked(seatApi.lookup).mockResolvedValue({
    items: [
      {
        customer: usage.customer,
        status: "정상",
        activeSession: null,
        usablePasses: [
          {
            id: "p1",
            kind: "시간권",
            productName: "600분권",
            remainingMinutes: 600,
            remainingCreditKrw: null,
            expiresAt: null,
            purchaseBranchId: "other",
          },
        ],
      },
    ],
  });
  vi.mocked(seatApi.checkIn).mockResolvedValue(usage);
  show();
  await open();
  await userEvent.click(screen.getByRole("button", { name: "직원 예외 입실" }));
  await userEvent.selectOptions(
    screen.getByLabelText("고객 조회 방식"),
    "phone",
  );
  await userEvent.type(screen.getByLabelText("정확한 연락처"), "010-1234-5678");
  await userEvent.click(screen.getByRole("button", { name: "입실 고객 조회" }));
  await screen.findByLabelText("입실 고객");
  expect(seatApi.lookup).toHaveBeenCalledWith(
    { branchId: "gangnam", phone: "010-1234-5678" },
    expect.any(AbortSignal),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("입실 고객"),
    "external-customer",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("사용 가능한 이용권"),
    "p1",
  );
  await userEvent.click(screen.getByRole("button", { name: "입실 확정" }));
  await waitFor(() =>
    expect(seatApi.checkIn).toHaveBeenCalledWith(
      { seatId: "s1", customerId: "external-customer", passId: "p1" },
      expect.any(AbortSignal),
      expect.any(String),
    ),
  );
});

it("gets an occupied session by id and displays only server checkout settlement", async () => {
  seat.status = "사용 중";
  seat.activeSession = {
    id: usage.id,
    customer: usage.customer,
    checkedInAt: usage.checkedInAt,
  };
  vi.mocked(seatApi.checkOut).mockResolvedValue({
    ...usage,
    status: "종료",
    checkedOutAt: "2026-11-02T01:31:00Z",
    usedMinutes: 91,
    deductedMinutes: 60,
    overageMinutes: 31,
    passRemainingMinutes: 0,
  });
  show("/spaces?detail=s1");
  await userEvent.click(
    await screen.findByRole("button", { name: "퇴실 처리" }),
  );
  await userEvent.type(
    await screen.findByLabelText("처리 사유 (선택)"),
    "현장 퇴실",
  );
  await userEvent.click(screen.getByRole("button", { name: "퇴실 확정" }));
  await screen.findByText("퇴실을 완료했어요");
  expect(seatApi.session).toHaveBeenCalledWith(
    "gangnam",
    "u1",
    expect.any(AbortSignal),
  );
  expect(seatApi.checkOut).toHaveBeenCalledWith(
    "u1",
    { reason: "현장 퇴실" },
    expect.any(AbortSignal),
    expect.any(String),
  );
  expect(screen.getByText("91분")).toBeInTheDocument();
  expect(screen.getByText("31분 · 0원")).toBeInTheDocument();
});

it("retries the same checkout after a lost response has already released the seat", async () => {
  seat.status = "사용 중";
  seat.activeSession = {
    id: usage.id,
    customer: usage.customer,
    checkedInAt: usage.checkedInAt,
  };
  const ended = {
    ...usage,
    status: "종료" as const,
    usedMinutes: 21,
    deductedMinutes: 21,
    passRemainingMinutes: 579,
  };
  vi.mocked(seatApi.checkOut)
    .mockImplementationOnce(async () => {
      seat = { ...seat, status: "사용 가능", activeSession: null };
      usage = { ...ended, passRemainingMinutes: null };
      throw new Error("응답을 받지 못했어요");
    })
    .mockResolvedValue(ended);
  show("/spaces?detail=s1");
  await userEvent.click(
    await screen.findByRole("button", { name: "퇴실 처리" }),
  );
  await userEvent.type(
    await screen.findByLabelText("처리 사유 (선택)"),
    "확인",
  );
  await userEvent.click(screen.getByRole("button", { name: "퇴실 확정" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "같은 퇴실 요청 다시 시도" }),
  );
  await screen.findByText("퇴실을 완료했어요");
  const calls = vi.mocked(seatApi.checkOut).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(calls[1][3]).toEqual(calls[0][3]);
  expect(screen.getByText("579분")).toBeInTheDocument();
});

it("keeps dirty seat input when closing is declined", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  show();
  await userEvent.click(
    await screen.findByRole("button", { name: "좌석 등록" }),
  );
  await userEvent.type(screen.getByLabelText("구역"), "작성 중인 구역");
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalled());
  expect(screen.getByLabelText("구역")).toHaveValue("작성 중인 구역");
});

it("rejects a detail URL whose seat belongs to a different selected branch", async () => {
  seat.branchId = "other";
  show("/spaces?detail=s1");
  await screen.findByText("선택한 지점의 좌석이 아니에요");
  expect(
    screen.queryByRole("button", { name: "좌석 수정" }),
  ).not.toBeInTheDocument();
});
