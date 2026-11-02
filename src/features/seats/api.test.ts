import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
import { api, ApiError } from "../../shared/api/client";
import { seatApi, type Seat, type SeatSession } from "./api";

const request = vi.mocked(api);
const signal = new AbortController().signal;
const at = "2026-11-02T10:00:00Z";
const seat: Seat = {
  id: "s",
  version: 1,
  branchId: "b",
  zone: "A",
  seatNo: "A-01",
  kind: "일반",
  status: "사용 가능",
  activeSession: null,
  createdAt: at,
};
const counts = {
  branchId: "b",
  total: 1,
  inUse: 0,
  available: 1,
  blocked: 0,
  occupancyRate: 0,
  asOf: at,
};
const board = { counts, zones: [{ zone: "A", seats: [seat] }] };
const session: SeatSession = {
  id: "session",
  version: 1,
  branchId: "b",
  status: "이용 중",
  seat: { id: "s", zone: "A", seatNo: "A-01" },
  customer: { id: "c", memberNo: "M-001", name: "고객" },
  pass: {
    id: "p",
    kind: "시간권",
    productName: "100시간",
    purchaseBranchId: "other",
  },
  checkedInAt: at,
  checkedOutAt: null,
  usedMinutes: 0,
  deductedMinutes: 0,
  deductedKrw: 0,
  overageMinutes: 0,
  overageKrw: 0,
  passRemainingMinutes: 6000,
  passRemainingCreditKrw: null,
  checkedInBy: { id: "staff", name: "직원" },
  checkInReason: null,
  moves: [],
};

beforeEach(() => {
  request.mockReset();
});
describe("canonical seat API", () => {
  it("uses atomic filtered board counts and the separate scoped occupancy contract", async () => {
    request
      .mockResolvedValueOnce(board)
      .mockResolvedValueOnce({ items: [counts] });
    expect(await seatApi.board("b", "일반", signal)).toEqual(board);
    expect(await seatApi.occupancy("all", signal)).toEqual({ items: [counts] });
    expect(request.mock.calls).toEqual([
      ["/seats/board?branchId=b&kind=%EC%9D%BC%EB%B0%98", { signal }],
      ["/seats/occupancy?scope=all", { signal }],
    ]);
  });
  it("keeps list filters in the contract and encodes detail path IDs", async () => {
    const page = { items: [seat], meta: { page: 2, pageSize: 10, total: 1 } };
    request.mockResolvedValueOnce(page).mockResolvedValueOnce(seat);
    await seatApi.list(
      "b",
      "zone=A&kind=일반&status=사용%20가능&page=2&pageSize=10&q=legacy&scope=other",
      signal,
    );
    await seatApi.detail("all", "a/b", signal);
    const params = Object.fromEntries(
      new URLSearchParams(request.mock.calls[0][0].split("?")[1]),
    );
    expect(params).toEqual({
      scope: "b",
      zone: "A",
      kind: "일반",
      status: "사용 가능",
      page: "2",
      pageSize: "10",
    });
    expect(request.mock.calls[1][0]).toBe("/seats/a%2Fb?scope=all");
  });
  it("creates idempotently and uses only version for updates and operating state", async () => {
    request.mockResolvedValue(seat);
    await seatApi.create(
      "b",
      {
        branchId: "b",
        zone: "A",
        seatNo: "A-01",
        kind: "일반",
        status: "사용 가능",
      },
      signal,
      "create-key",
    );
    await seatApi.update("b", "a/b", { version: 2, zone: "B" }, signal);
    await seatApi.status(
      "b",
      "a/b",
      { version: 3, status: "운영 중단", reason: "수리" },
      signal,
    );
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "POST",
      key: "create-key",
    });
    expect(request.mock.calls[1][0]).toBe("/seats/a%2Fb?scope=b");
    expect(request.mock.calls[1][1]).not.toHaveProperty("key");
    expect(request.mock.calls[1][1]?.body).not.toHaveProperty("status");
    expect(request.mock.calls[2]).toEqual([
      "/seats/a%2Fb/status?scope=b",
      {
        method: "POST",
        body: { version: 3, status: "운영 중단", reason: "수리" },
        signal,
      },
    ]);
  });
  it("sends exact lookup criteria privately in a POST body with usable cross-branch passes", async () => {
    const result = {
      items: [
        {
          customer: session.customer,
          status: "정상",
          activeSession: null,
          usablePasses: [
            {
              id: "p",
              kind: "시간권",
              productName: "100시간",
              remainingMinutes: 6000,
              remainingCreditKrw: null,
              expiresAt: null,
              purchaseBranchId: "other",
            },
          ],
        },
      ],
    };
    request.mockResolvedValueOnce(result);
    expect(
      await seatApi.lookup({ branchId: "b", phone: "010-1234-5678" }, signal),
    ).toEqual(result);
    expect(request.mock.calls[0]).toEqual([
      "/customer-lookups/check-in",
      {
        method: "POST",
        body: { branchId: "b", phone: "010-1234-5678", memberNo: undefined },
        signal,
      },
    ]);
    expect(request.mock.calls[0][1]).not.toHaveProperty("key");
  });
  it("keeps session commands unscoped and sends no client charge or timestamp", async () => {
    request.mockResolvedValue(session);
    await seatApi.checkIn(
      { seatId: "s", customerId: "c", passId: "p", reason: "현장" },
      signal,
      "in-key",
    );
    await seatApi.checkOut("a/b", { reason: "퇴실" }, signal, "out-key");
    await seatApi.move(
      "a/b",
      { toSeatId: "other-seat", reason: "이동" },
      signal,
      "move-key",
    );
    await seatApi.session("all", "a/b", signal);
    expect(request.mock.calls).toEqual([
      [
        "/seat-sessions",
        {
          method: "POST",
          body: { seatId: "s", customerId: "c", passId: "p", reason: "현장" },
          signal,
          key: "in-key",
        },
      ],
      [
        "/seat-sessions/a%2Fb/check-out",
        { method: "POST", body: { reason: "퇴실" }, signal, key: "out-key" },
      ],
      [
        "/seat-sessions/a%2Fb/move",
        {
          method: "POST",
          body: { toSeatId: "other-seat", reason: "이동" },
          signal,
          key: "move-key",
        },
      ],
      ["/seat-sessions/a%2Fb?scope=all", { signal }],
    ]);
  });
  it("accepts server-calculated checkout amounts and null historical balances", async () => {
    const closed = {
      ...session,
      status: "종료",
      checkedOutAt: at,
      usedMinutes: 91,
      deductedMinutes: 60,
      overageMinutes: 31,
      passRemainingMinutes: null,
    };
    request.mockResolvedValueOnce(closed);
    expect(await seatApi.session("b", "session", signal)).toEqual(closed);
  });
  it.each([
    undefined,
    { ...board, counts: { ...counts, available: 0 } },
    { ...board, counts: { ...counts, occupancyRate: null } },
    { ...board, counts: { ...counts, branchId: "other" } },
    {
      ...board,
      zones: [{ zone: "A", seats: [{ ...seat, status: "사용 중" }] }],
    },
    { ...board, zones: [{ zone: "A", seats: [{ ...seat, kind: "기타" }] }] },
  ])(
    "rejects malformed or inconsistent atomic board responses %#",
    async (value) => {
      request.mockResolvedValueOnce(value);
      await expect(seatApi.board("b", "일반", signal)).rejects.toMatchObject({
        detail: { code: "INVALID_RESPONSE" },
      });
    },
  );
  it("distinguishes no seats from zero percent occupancy", async () => {
    const empty = {
      counts: { ...counts, total: 0, available: 0, occupancyRate: null },
      zones: [],
    };
    request.mockResolvedValueOnce(empty);
    expect(await seatApi.board("b", "", signal)).toEqual(empty);
  });
  it("rejects malformed writes, lookup, list, occupancy and session instead of fake success", async () => {
    request.mockResolvedValue(undefined);
    const calls = [
      seatApi.update("b", "s", { version: 1 }, signal),
      seatApi.checkOut("session", {}, signal, "key"),
      seatApi.lookup({ branchId: "b", memberNo: "M-001" }, signal),
      seatApi.list("b", "", signal),
      seatApi.occupancy("all", signal),
      seatApi.session("b", "s", signal),
    ];
    for (const call of calls)
      await expect(call).rejects.toMatchObject({
        detail: { code: "INVALID_RESPONSE" },
      });
  });
  it.each([403, 404, 409, 422, 500])(
    "preserves HTTP %i without fake success",
    async (status) => {
      const error = new ApiError(status, {
        code: "TEST_ERROR",
        message: "실패",
      });
      request.mockRejectedValueOnce(error);
      await expect(
        seatApi.checkIn(
          { seatId: "s", customerId: "c", passId: "p" },
          signal,
          "key",
        ),
      ).rejects.toBe(error);
    },
  );
});
