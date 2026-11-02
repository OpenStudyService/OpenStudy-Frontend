import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { useTaskWrite } from "./hooks";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
let query: QueryClient;
beforeEach(() => {
  const store = new MockStore(false);
  store.persona = "junho";
  context.value = {
    session: {
      user: store.user(),
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "test",
    },
    scope: "gangnam",
    lookups: { ...store.db, preview: false },
  };
  query = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
});
afterEach(() => {
  cleanup();
  query.clear();
});
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={query}>{children}</QueryClientProvider>;
}
function mountedViews(read: () => string) {
  return renderHook(
    () => ({
      list: useQuery({
        queryKey: ["data", "junho", "gangnam", "tasks", "list"],
        queryFn: async () => ({ status: read() }),
      }),
      summary: useQuery({
        queryKey: ["data", "junho", "gangnam", "tasks", "summary"],
        queryFn: async () => ({ done: read() === "완료" ? 1 : 0 }),
      }),
    }),
    { wrapper: Wrapper },
  );
}

it("refreshes surviving list and summary after a committed write response is aborted by panel close", async () => {
  let serverStatus = "할 일";
  const views = mountedViews(() => serverStatus);
  const writer = renderHook(() => useTaskWrite(), { wrapper: Wrapper });
  await waitFor(() => expect(views.result.current.summary.data?.done).toBe(0));
  const onSaved = vi.fn(),
    toast = vi.fn();
  let deliver: (() => void) | undefined;
  let pending!: Promise<unknown>;
  act(() => {
    pending = writer.result.current
      .run("tasks/task-2/status", { version: 1, status: "완료" }, (signal) => {
        serverStatus = "완료"; // Server commit precedes its deliberately delayed response.
        return new Promise<{ status: string }>((resolve, reject) => {
          deliver = () => resolve({ status: serverStatus });
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Closed", "AbortError")),
            { once: true },
          );
        });
      })
      .then((value) => {
        onSaved(value);
        toast("저장 완료");
        return value;
      })
      .catch((error) => error);
  });
  writer.unmount();
  const failure = await pending;
  expect(failure).toBeInstanceOf(DOMException);
  await waitFor(() => expect(views.result.current.summary.data?.done).toBe(1));
  expect(views.result.current.list.data?.status).toBe("완료");
  await act(async () => {
    deliver?.();
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

it("reconciles a committed write after a lost network response while preserving its retry key", async () => {
  let serverStatus = "할 일";
  const views = mountedViews(() => serverStatus),
    writer = renderHook(() => useTaskWrite(), { wrapper: Wrapper });
  await waitFor(() => expect(views.result.current.summary.data?.done).toBe(0));
  const keys: string[] = [];
  await act(async () => {
    await expect(
      writer.result.current.run(
        "tasks/new",
        { title: "새 업무" },
        async (_signal, key) => {
          keys.push(key);
          serverStatus = "완료";
          throw new ApiError(0, {
            code: "NETWORK_ERROR",
            message: "연결 실패",
          });
        },
      ),
    ).rejects.toMatchObject({ status: 0 });
  });
  await waitFor(() => expect(views.result.current.summary.data?.done).toBe(1));
  expect(views.result.current.list.data?.status).toBe("완료");
  await act(async () => {
    await writer.result.current.run(
      "tasks/new",
      { title: "새 업무" },
      async (_signal, key) => {
        keys.push(key);
        return {};
      },
    );
  });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

it("does not invalidate task data for an aborted latest-value read", async () => {
  const writer = renderHook(() => useTaskWrite(), { wrapper: Wrapper });
  const invalidate = vi.spyOn(query, "invalidateQueries");
  let pending!: Promise<unknown>;
  act(() => {
    pending = writer.result.current
      .run(
        "read-latest",
        {},
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Closed", "AbortError")),
              { once: true },
            );
          }),
        false,
      )
      .catch((error) => error);
  });
  writer.unmount();
  await pending;
  expect(invalidate).not.toHaveBeenCalled();
});
