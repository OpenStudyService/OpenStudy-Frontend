import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useVisibleRefresh } from "./hooks";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("refreshes every 15 seconds, pauses while hidden, and resumes on return", async () => {
  vi.useFakeTimers();
  let visible = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visible as DocumentVisibilityState,
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() => useVisibleRefresh(refresh));
  await act(() => vi.advanceTimersByTimeAsync(14999));
  expect(refresh).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(refresh).toHaveBeenCalledTimes(1);
  visible = "hidden";
  await act(() => vi.advanceTimersByTimeAsync(45000));
  expect(refresh).toHaveBeenCalledTimes(1);
  visible = "visible";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("does not overlap requests when the periodic tick and window focus coincide", async () => {
  vi.useFakeTimers();
  let done!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  renderHook(() => useVisibleRefresh(refresh));
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => done());
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
