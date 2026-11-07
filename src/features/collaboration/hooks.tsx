import { invalidateReads } from "../../shared/api/invalidateReads";
import { useEffect, useRef, useState } from "react";
export { useLeaveGuard as useRecordLeaveGuard } from "../../shared/ui/leaveGuard";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";

export function useRecordWrite(...resources: string[]) {
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
    detailKey?: readonly unknown[],
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
        if (detailKey) {
          // An older in-flight GET must not replace the command's returned version.
          await query.cancelQueries({ queryKey: detailKey });
          current.signal.throwIfAborted();
          query.setQueryData(detailKey, result);
        }
        idempotencyRef.current.committed();
        void invalidateReads(query, session.user.id, ...resources, "home");
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
        void invalidateReads(query, session.user.id, ...resources, "home");
      }
      if (error instanceof ApiError && error.status === 403) {
        void query.invalidateQueries({ queryKey: ["session"] });
        void invalidateReads(query, session.user.id, ...resources, "lookups");
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
