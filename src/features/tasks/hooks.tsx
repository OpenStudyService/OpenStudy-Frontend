import { useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { taskApi } from "./api";

export function useTaskDetail(id: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "detail", id],
    queryFn: ({ signal }) => taskApi.detail(scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
}
export function useTaskAssignees(branch: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "assignees", branch],
    queryFn: ({ signal }) => taskApi.assignees(branch, signal),
    enabled: !!branch && branch !== "all",
    retry: false,
  });
}
export function useTaskWrite() {
  const { session, scope } = useApp(),
    query = useQueryClient();
  const permissionKey = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    idempotency = useIdempotency();
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, [permissionKey]);
  async function run<T>(
    operation: string,
    body: unknown,
    request: (signal: AbortSignal, key: string) => Promise<T>,
    commit = true,
  ): Promise<T> {
    if (lock.current) throw new Error("처리 중입니다. 잠시 기다려 주세요.");
    const current = controller.current;
    if (!current) throw new Error("화면 준비 중입니다. 다시 시도해 주세요.");
    current.signal.throwIfAborted();
    lock.current = true;
    setBusy(true);
    try {
      const result = await request(
        current.signal,
        idempotency.key(operation, body),
      );
      current.signal.throwIfAborted();
      if (commit) {
        idempotency.committed();
        void query.invalidateQueries({ queryKey: ["data", session.user.id] });
      }
      current.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        void query.invalidateQueries({ queryKey: ["session"] });
        void query.invalidateQueries({
          queryKey: ["data", session.user.id, scope, "tasks"],
        });
      }
      throw error;
    } finally {
      lock.current = false;
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return { run, busy };
}

const leaveMessage =
  "저장하지 않은 변경사항이 있어요. 입력을 버리고 이동할까요?";
function RouterLeaveGuard({ dirty }: { dirty: React.RefObject<boolean> }) {
  const blocker = useBlocker(
    ({ nextLocation }) =>
      dirty.current &&
      !["/login", "/pending-approval"].includes(nextLocation.pathname),
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm(leaveMessage)) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  return null;
}
export function useTaskLeaveGuard(changed: boolean) {
  const dirty = useRef(changed);
  useEffect(() => {
    dirty.current = changed;
  }, [changed]);
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  return {
    guard: router ? <RouterLeaveGuard dirty={dirty} /> : null,
    saved: () => {
      dirty.current = false;
    },
  };
}
