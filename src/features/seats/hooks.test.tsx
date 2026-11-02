import type { PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../app/context";
vi.mock("../../app/context", () => ({ useApp: vi.fn() }));
vi.mock("./api", () => ({
  seatApi: {
    board: vi.fn(),
    occupancy: vi.fn(),
    detail: vi.fn(),
    session: vi.fn(),
  },
}));
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { seatApi } from "./api";
import {
  useSeatBoard,
  useSeatDetail,
  useSeatOccupancy,
  useSeatSession,
  useSeatWrite,
} from "./hooks";

let context: AppContext;
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  context = {
    scope: "b",
    session: {
      user: {
        id: "first",
        status: "활성",
        owner: false,
        memberships: [
          { branchId: "b", role: "staff", permissions: [], status: "활성" },
        ],
      },
    },
    lookups: {},
  } as unknown as AppContext;
  vi.mocked(useApp).mockImplementation(() => context);
});
describe("seat query isolation", () => {
  it("loads a filtered atomic board under current user/scope keys and forwards cancellation", async () => {
    const value = { counts: { asOf: "server-time" }, zones: [] };
    vi.mocked(seatApi.board).mockResolvedValue(value as never);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useSeatBoard("b", "일반"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seatApi.board).toHaveBeenCalledWith(
      "b",
      "일반",
      expect.any(AbortSignal),
    );
    expect(
      client.getQueryData([
        "data",
        "first",
        "b",
        "seats",
        "board",
        "b",
        "일반",
      ]),
    ).toEqual(value);
  });
  it("does not query all/new/empty as concrete resources", () => {
    const { wrapper } = setup();
    renderHook(
      () => {
        useSeatBoard("all");
        useSeatDetail("new");
        useSeatSession("");
      },
      { wrapper },
    );
    expect(seatApi.board).not.toHaveBeenCalled();
    expect(seatApi.detail).not.toHaveBeenCalled();
    expect(seatApi.session).not.toHaveBeenCalled();
  });
  it("loads occupancy and session/detail through canonical scoped reads", async () => {
    vi.mocked(seatApi.occupancy).mockResolvedValue({ items: [] });
    vi.mocked(seatApi.detail).mockResolvedValue({ id: "s" } as never);
    vi.mocked(seatApi.session).mockResolvedValue({ id: "session" } as never);
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        occupancy: useSeatOccupancy(),
        detail: useSeatDetail("s"),
        session: useSeatSession("session"),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(
        result.current.occupancy.isSuccess &&
          result.current.detail.isSuccess &&
          result.current.session.isSuccess,
      ).toBe(true),
    );
    expect(seatApi.occupancy).toHaveBeenCalledWith(
      "b",
      expect.any(AbortSignal),
    );
    expect(seatApi.detail).toHaveBeenCalledWith(
      "b",
      "s",
      expect.any(AbortSignal),
    );
    expect(seatApi.session).toHaveBeenCalledWith(
      "b",
      "session",
      expect.any(AbortSignal),
    );
  });
});
describe("seat write lifecycle", () => {
  it("synchronously locks duplicate submissions before rerender and invalidates all coupled resources", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pending = deferred<string>();
    const request = vi.fn((signal: AbortSignal) => {
      signal.throwIfAborted();
      return pending.promise;
    });
    const { result } = renderHook(() => useSeatWrite(), { wrapper });
    let first!: Promise<string>;
    act(() => {
      first = result.current.run("check-in", { seatId: "s" }, request);
    });
    await act(async () => {
      await expect(
        result.current.run("check-in", { seatId: "s" }, request),
      ).rejects.toThrow("처리 중");
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      pending.resolve("done");
      expect(await first).toBe("done");
    });
    expect(result.current.busy).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["data", "first"] });
  });
  it("retains the logical request key after an uncertain response and changes it for changed input", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const failure = new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "연결 실패",
    });
    const request = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() => useSeatWrite(), { wrapper });
    await act(async () => {
      await expect(
        result.current.run("check-in", { seatId: "s" }, request),
      ).rejects.toBe(failure);
    });
    await act(async () => {
      await expect(
        result.current.run("check-in", { seatId: "s" }, request),
      ).rejects.toBe(failure);
    });
    await act(async () => {
      await expect(
        result.current.run("check-in", { seatId: "other" }, request),
      ).rejects.toBe(failure);
    });
    expect(request.mock.calls[0][1]).toBe(request.mock.calls[1][1]);
    expect(request.mock.calls[0][1]).not.toBe(request.mock.calls[2][1]);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });
  it("ends successful logical writes so a later identical command gets a fresh key", async () => {
    const { wrapper } = setup();
    const request = vi.fn().mockResolvedValue("done");
    const { result } = renderHook(() => useSeatWrite(), { wrapper });
    await act(async () => {
      await result.current.run("move:session", { toSeatId: "s" }, request);
    });
    await act(async () => {
      await result.current.run("move:session", { toSeatId: "s" }, request);
    });
    expect(request.mock.calls[0][1]).not.toBe(request.mock.calls[1][1]);
  });
  it("invalidates the initiating user's caches after a scope/account switch and suppresses stale success", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pending = deferred<string>();
    const request = vi.fn((signal: AbortSignal) => {
      signal.throwIfAborted();
      return pending.promise;
    });
    const { result, rerender } = renderHook(() => useSeatWrite(), { wrapper });
    let first!: Promise<string>;
    act(() => {
      first = result.current.run("check-out:session", {}, request);
    });
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    context = {
      ...context,
      scope: "other",
      session: {
        ...context.session,
        user: { ...context.session.user, id: "second" },
      },
    };
    rerender();
    expect(request.mock.calls[0][0].aborted).toBe(true);
    await act(async () => {
      pending.resolve("server committed");
      await rejected;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["data", "first"] });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["data", "second"],
    });
    expect(result.current.busy).toBe(false);
  });
  it("invalidates surviving views after unmount even when the server has already committed", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pending = deferred<string>();
    const { result, unmount } = renderHook(() => useSeatWrite(), { wrapper });
    let first!: Promise<string>;
    act(() => {
      first = result.current.run(
        "check-out:session",
        {},
        () => pending.promise,
      );
    });
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    unmount();
    await act(async () => {
      pending.resolve("server committed");
      await rejected;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["data", "first"] });
  });
  it.each([401, 403])(
    "refreshes session grants after HTTP %i, including lookup-only requests",
    async (status) => {
      const { client, wrapper } = setup();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const error = new ApiError(status, {
        code: "FORBIDDEN",
        message: "권한 없음",
      });
      const { result } = renderHook(() => useSeatWrite(), { wrapper });
      await act(async () => {
        await expect(
          result.current.run("lookup", {}, () => Promise.reject(error), false),
        ).rejects.toBe(error);
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["data", "first"] });
    },
  );
  it("preserves scoped 404 and conflicts without reporting success", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSeatWrite(), { wrapper });
    for (const status of [404, 409]) {
      const error = new ApiError(status, {
        code: status === 404 ? "NOT_FOUND" : "SEAT_OCCUPIED",
        message: "실패",
      });
      await act(async () => {
        await expect(
          result.current.run("move:session", { toSeatId: "s" }, () =>
            Promise.reject(error),
          ),
        ).rejects.toBe(error);
      });
    }
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["session"] });
  });
});
