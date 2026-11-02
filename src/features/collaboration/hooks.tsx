import { useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";

export function useRecordWrite() {
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
        void query.invalidateQueries({ queryKey: ["data", session.user.id] });
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
        void query.invalidateQueries({ queryKey: ["data", session.user.id] });
      }
      if (error instanceof ApiError && error.status === 403) {
        void query.invalidateQueries({ queryKey: ["session"] });
        void query.invalidateQueries({
          queryKey: ["data", session.user.id, scope],
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
export function useRecordLeaveGuard(changed: boolean) {
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
