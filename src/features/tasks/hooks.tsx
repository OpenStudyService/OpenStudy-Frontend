import { invalidateReads } from "../../shared/api/invalidateReads";
import { useEffect, useRef, useState } from "react";
export { useLeaveGuard as useTaskLeaveGuard } from "../../shared/ui/leaveGuard";
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
  const lock = useRef<AbortController | null>(null),
    [busyState, setBusyState] = useState({ key: permissionKey, busy: false }),
    idempotency = useIdempotency();
  const idempotencyRef = useRef(idempotency);
  const busy = busyState.key === permissionKey && busyState.busy;
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    lock.current = null;
    idempotencyRef.current.committed();
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
    lock.current = current;
    setBusyState({ key: permissionKey, busy: true });
    try {
      const result = await request(
        current.signal,
        idempotencyRef.current.key(operation, body),
      );
      current.signal.throwIfAborted();
      if (commit) {
        idempotencyRef.current.committed();
        void invalidateReads(query, session.user.id, "tasks", "home", "chat");
      }
      current.signal.throwIfAborted();
      return result;
    } catch (error) {
      // Cancelling the response cannot roll back a write already committed by
      // the server. Refresh surviving views without allowing stale callbacks.
      if (
        commit &&
        (current.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof ApiError && error.status === 0))
      ) {
        void invalidateReads(query, session.user.id, "tasks", "home", "chat");
      }
      if (error instanceof ApiError && error.status === 403) {
        void query.invalidateQueries({ queryKey: ["session"] });
        void query.invalidateQueries({
          queryKey: ["data", session.user.id, scope, "tasks"],
        });
      }
      throw error;
    } finally {
      if (lock.current === current) {
        lock.current = null;
        if (!current.signal.aborted)
          setBusyState({ key: permissionKey, busy: false });
      }
    }
  }
  return { run, busy };
}

export function useTaskEvents(id: string, page = 1) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "events", id, page],
    queryFn: ({ signal }) => taskApi.events(scope, id, signal, page),
    enabled: !!id && id !== "new",
    retry: false,
  });
}
export function useTaskSummary(search: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "summary", search],
    queryFn: ({ signal }) => taskApi.summary(scope, search, signal),
    retry: false,
  });
}
