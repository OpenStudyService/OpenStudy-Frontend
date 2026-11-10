import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { RoomPanel } from "./RoomPanel";
import { ReservationPanel } from "./ReservationPanel";
import { ReservationCreate } from "./ReservationCreate";
import { Reservations } from "./RoomPages";
import type { Room, RoomReservation } from "./model";
import { roomApi } from "./api";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  roomApi: {
    room: vi.fn(),
    rooms: vi.fn(),
    updateRoom: vi.fn(),
    roomStatus: vi.fn(),
    createRoom: vi.fn(),
    reservation: vi.fn(),
    reservations: vi.fn(),
    calendar: vi.fn(),
    createReservation: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    complete: vi.fn(),
  },
}));
vi.mock("../payments/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../payments/shared")>()),
  CustomerSelector: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (id: string) => void;
  }) => (
    <label>
      고객 선택
      <select
        aria-label="고객 선택"
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">고객 선택</option>
        <option value="c1">조회된 고객</option>
      </select>
    </label>
  ),
}));
let room: Room, reservation: RoomReservation;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  store.persona = "owner";
  context.value = {
    scope: "gangnam",
    session: {
      user: store.user(),
      branches: store.db.branches,
      asOf: "2026-11-03T03:00:00Z",
      snapshotVersion: "test",
    },
    lookups: { ...store.db },
  };
  room = {
    id: "r1",
    version: 1,
    branchId: "gangnam",
    roomNo: "A1",
    name: "공부방",
    capacity: 4,
    ratePerHourKrw: 8000,
    status: "사용 가능",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
  reservation = {
    id: "booking1",
    version: 1,
    branchId: "gangnam",
    status: "확정",
    room: { id: room.id, roomNo: room.roomNo, name: room.name },
    customer: { id: "c1", name: "고객", memberNo: "C1" },
    startAt: "2030-01-01T03:00:00Z",
    endAt: "2030-01-01T06:00:00Z",
    billing: {
      ratePerHourKrw: 8000,
      hours: 3,
      amountKrw: 24000,
      paymentId: "p1",
      paymentStatus: "승인",
    },
    usage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdBy: { id: "owner", name: "사장님" },
    createdAt: room.createdAt,
    canCancel: true,
  };
  vi.mocked(roomApi.room).mockResolvedValue(room);
  vi.mocked(roomApi.rooms).mockResolvedValue({
    items: [room],
    meta: { page: 1, pageSize: 100, total: 1 },
  });
  vi.mocked(roomApi.reservation).mockResolvedValue(reservation);
  vi.mocked(roomApi.calendar).mockResolvedValue({
    from: "2030-01-01T00:00:00Z",
    to: "2030-01-03T00:00:00Z",
    items: [reservation],
  });
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function mount(element: React.ReactNode, search = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[search]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, user: userEvent.setup(), client };
}
async function bookingFields(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "A1 · 공부방 · 4명" });
  await user.selectOptions(screen.getByLabelText("예약 룸"), "r1");
  await user.selectOptions(screen.getByLabelText("고객 선택"), "c1");
  await user.clear(screen.getByLabelText("예약 날짜"));
  await user.type(screen.getByLabelText("예약 날짜"), "2030-01-01");
  await user.selectOptions(
    screen.getByLabelText("시작 시각 (한국 시간)"),
    "12",
  );
  await user.selectOptions(screen.getByLabelText("이용 시간"), "3");
}
it("keeps a room edit through 409 and re-saves only changed fields against the compared version", async () => {
  const latest = { ...room, version: 2, ratePerHourKrw: 10000 };
  vi.mocked(roomApi.updateRoom)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "충돌" }),
    )
    .mockResolvedValue({ ...latest, name: "새 이름", version: 3 });
  const { user } = mount(<RoomPanel id="r1" onClose={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "수정하기" }));
  await user.clear(screen.getByLabelText("룸 이름"));
  await user.type(screen.getByLabelText("룸 이름"), "새 이름");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(screen.getByLabelText("룸 이름")).toHaveValue("새 이름");
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  vi.mocked(roomApi.room).mockResolvedValue(latest);
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(
    await screen.findByRole("heading", { name: "최신 서버 내용" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await screen.findByRole("button", { name: "수정하기" });
  expect(vi.mocked(roomApi.updateRoom).mock.calls[1][2]).toEqual({
    version: 2,
    name: "새 이름",
  });
});
it("uses whole-hour selectors, displays only the server hourly price before booking, and retries with the same key", async () => {
  const saved = vi.fn();
  vi.mocked(roomApi.createReservation)
    .mockRejectedValueOnce(
      new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
    )
    .mockResolvedValue(reservation);
  const { user } = mount(<ReservationCreate onSaved={saved} />);
  await bookingFields(user);
  expect(
    screen.getByLabelText("시작 시각 (한국 시간)").querySelectorAll("option"),
  ).toHaveLength(24);
  expect(screen.getByText(/시간당 요금 8,000원/)).toBeVisible();
  expect(screen.queryByText(/24,000/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "예약 등록" }));
  expect(await screen.findByText("응답 유실")).toBeVisible();
  expect(screen.getByLabelText("예약 날짜")).toHaveValue("2030-01-01");
  await user.click(screen.getByRole("button", { name: "예약 등록" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(reservation));
  const calls = vi.mocked(roomApi.createReservation).mock.calls;
  expect(calls[1][3]).toBe(calls[0][3]);
  expect(calls[0][1]).toEqual({
    branchId: "gangnam",
    roomId: "r1",
    customerId: "c1",
    startAt: "2030-01-01T12:00:00+09:00",
    endAt: "2030-01-01T06:00:00.000Z",
    partySize: 1,
    method: "카드",
    mockOutcome: "APPROVED",
  });
});
it("keeps booking input and reloads actual schedules for a time conflict instead of treating it as a version conflict", async () => {
  vi.mocked(roomApi.createReservation).mockRejectedValue(
    new ApiError(409, { code: "ROOM_TIME_CONFLICT", message: "시간 충돌" }),
  );
  const { user } = mount(<ReservationCreate onSaved={vi.fn()} />);
  await bookingFields(user);
  await user.click(screen.getByRole("button", { name: "예약 등록" }));
  expect(
    await screen.findByRole("region", { name: "최신 예약 일정" }),
  ).toBeVisible();
  expect(screen.getByLabelText("예약 날짜")).toHaveValue("2030-01-01");
  expect(screen.getByRole("button", { name: "예약 등록" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "최신 내용 확인" }),
  ).not.toBeInTheDocument();
  expect(roomApi.calendar).toHaveBeenCalled();
});
it("hides cancellation once the start boundary has passed even with a stale server canCancel hint", async () => {
  vi.mocked(roomApi.reservation).mockResolvedValue({
    ...reservation,
    startAt: "2026-11-03T02:00:00Z",
    endAt: "2026-11-03T04:00:00Z",
  });
  mount(
    <ReservationPanel id="booking1" onClose={vi.fn()} onSelected={vi.fn()} />,
  );
  expect(
    await screen.findByRole("button", { name: "이용 시작" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "예약 취소" }),
  ).not.toBeInTheDocument();
});
it("blocks a direct new booking URL without payment permission while allowing non-payment usage processing", async () => {
  const store = new MockStore(false);
  store.persona = "junho";
  context.value.session.user = store.user();
  mount(<ReservationPanel id="new" onClose={vi.fn()} onSelected={vi.fn()} />);
  expect(screen.getByText("예약 등록 권한이 없어요")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "예약 등록" }),
  ).not.toBeInTheDocument();
});
it("ignores a booking write response after the form has unmounted", async () => {
  let resolve!: (row: RoomReservation) => void;
  let signal!: AbortSignal;
  vi.mocked(roomApi.createReservation).mockImplementation(
    (_scope, _body, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    },
  );
  const saved = vi.fn(),
    { user, unmount } = mount(<ReservationCreate onSaved={saved} />);
  await bookingFields(user);
  await user.click(screen.getByRole("button", { name: "예약 등록" }));
  unmount();
  expect(signal.aborted).toBe(true);
  resolve(reservation);
  await new Promise((r) => setTimeout(r, 0));
  expect(saved).not.toHaveBeenCalled();
});
it("renders invalid calendar ranges as guidance without firing a calendar request", () => {
  mount(<Reservations />, "/?from=not-a-date&view=calendar");
  expect(screen.getByText("조회 기간을 확인하세요")).toBeVisible();
  expect(roomApi.calendar).not.toHaveBeenCalled();
});
it("keeps the originally requested room status through background changes and explicit conflict comparison", async () => {
  const stopped = { ...room, status: "운영 중단" as const, version: 2 };
  vi.mocked(roomApi.roomStatus)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "충돌" }),
    )
    .mockResolvedValue(stopped);
  const { user, client } = mount(<RoomPanel id="r1" onClose={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "운영 중단" }));
  await user.type(screen.getByLabelText("운영 변경 사유"), "시설 정비");
  client.setQueryData(
    ["data", "owner", "gangnam", "rooms", "detail", "r1"],
    stopped,
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  vi.mocked(roomApi.room).mockResolvedValue(stopped);
  await user.click(
    await screen.findByRole("button", { name: "최신 내용 확인" }),
  );
  await screen.findByRole("heading", { name: "최신 서버 내용" });
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await screen.findByRole("button", { name: "운영 재개" });
  expect(vi.mocked(roomApi.roomStatus).mock.calls.map((c) => c[2])).toEqual([
    { version: 1, status: "운영 중단", reason: "시설 정비" },
    { version: 2, status: "운영 중단", reason: "시설 정비" },
  ]);
});
it("retries a lost cancellation response with the same key and original version even after a background read sees cancellation", async () => {
  const cancelled = {
    ...reservation,
    status: "취소" as const,
    canCancel: false,
    version: 2,
  };
  vi.mocked(roomApi.cancel)
    .mockRejectedValueOnce(
      new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
    )
    .mockResolvedValue(cancelled);
  const { user } = mount(
    <ReservationPanel id="booking1" onClose={vi.fn()} onSelected={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "예약 취소" }));
  await user.type(screen.getByLabelText("취소 사유"), "일정 변경");
  vi.mocked(roomApi.reservation).mockResolvedValue(cancelled);
  await user.click(screen.getByRole("button", { name: "예약 취소·전액 환불" }));
  expect(await screen.findByText("응답 유실")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "예약 취소·전액 환불" }));
  await screen.findByRole("button", { name: "새 예약으로 재예약" });
  const calls = vi.mocked(roomApi.cancel).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1][4]).toBe(calls[0][4]);
  expect(calls[1][2]).toEqual({ version: 1, reason: "일정 변경" });
});
it("does not keep a private room title after an access-denied detail refresh", async () => {
  const { client } = mount(<RoomPanel id="r1" onClose={vi.fn()} />);
  await screen.findByRole("heading", { name: "공부방" });
  vi.mocked(roomApi.room).mockRejectedValue(
    new ApiError(404, { code: "NOT_FOUND", message: "접근 불가" }),
  );
  await client.invalidateQueries({
    queryKey: ["data", "owner", "gangnam", "rooms", "detail", "r1"],
  });
  expect(
    await screen.findByRole("heading", { name: "스터디룸 상세" }),
  ).toBeVisible();
  expect(screen.queryByText("공부방")).not.toBeInTheDocument();
});

it("disables start and duration selection on a branch closure date", async () => {
  vi.mocked(roomApi.calendar).mockResolvedValue({
    from: "2026-11-03T00:00:00+09:00",
    to: "2026-11-04T15:00:00Z",
    items: [],
    closedDates: ["2026-11-03"],
  });
  mount(<ReservationCreate onSaved={vi.fn()} />);
  expect(
    await screen.findByText("지점 휴무일에는 새 예약을 시작할 수 없어요."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("시작 시각 (한국 시간)")).toBeDisabled();
  expect(screen.getByLabelText("이용 시간")).toBeDisabled();
  expect(screen.getByRole("button", { name: "예약 등록" })).toBeDisabled();
});
