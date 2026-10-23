import { afterEach, expect, it, vi } from "vitest";
import { closeStreams, openStream } from "./stream";
class Source {
  static all: Source[] = [];
  onopen?: () => void;
  onerror?: () => void;
  listeners: Record<string, (event: MessageEvent) => void> = {};
  close = vi.fn();
  constructor(public url: URL) {
    Source.all.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners[type] = listener;
  }
}
afterEach(() => {
  closeStreams();
  Source.all = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("reconnects with cursor and ignores events from closed sources", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Source);
  const listener = vi.fn(),
    status = vi.fn();
  const stop = openStream(
    "/api/workspace/events?scope=1",
    { workspace: listener },
    status,
  );
  const first = Source.all[0];
  first.listeners.workspace(
    new MessageEvent("workspace", { lastEventId: "cursor-1" }),
  );
  first.onerror!();
  vi.advanceTimersByTime(1000);
  expect(Source.all[1].url.searchParams.get("cursor")).toBe("cursor-1");
  first.listeners.workspace(new MessageEvent("workspace"));
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  Source.all[1].onerror!();
  vi.advanceTimersByTime(20000);
  expect(Source.all).toHaveLength(2);
});
it("closes all private streams and suppresses queued callbacks on logout", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Source);
  const listener = vi.fn(),
    status = vi.fn();
  openStream("/api/workspace/events", { workspace: listener }, status);
  const source = Source.all[0];
  closeStreams();
  source.onopen!();
  source.onerror!();
  source.listeners.workspace(new MessageEvent("workspace"));
  vi.advanceTimersByTime(20000);
  expect(source.close).toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
  expect(Source.all).toHaveLength(1);
});
