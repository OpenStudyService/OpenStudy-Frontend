import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { customerApi } from "./api";
import { customerKeys } from "./model";
export { useTaskLeaveGuard as useCustomerLeaveGuard } from "../tasks/hooks";

export function useCustomerDetail(id: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: customerKeys.detail(session.user.id, scope, id),
    queryFn: ({ signal }) => customerApi.detail(scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
}
export function useCustomerWrite() {
  const { session, scope } = useApp(),
    query = useQueryClient();
  const identity = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  const controller = useRef<AbortController | null>(null),
    lock = useRef(false),
    ids = useIdempotency();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, [identity]);
  async function run<T>(
    operation: string,
    body: unknown,
    request: (signal: AbortSignal, key: string) => Promise<T>,
    commit = true,
  ): Promise<T> {
    if (lock.current) throw new Error("처리 중입니다. 잠시 기다려 주세요.");
    const current = controller.current;
    if (!current)
      throw new Error("화면을 준비하고 있어요. 다시 시도해 주세요.");
    current.signal.throwIfAborted();
    lock.current = true;
    setBusy(true);
    try {
      const result = await request(current.signal, ids.key(operation, body));
      current.signal.throwIfAborted();
      if (commit) {
        ids.committed();
        void query.invalidateQueries({ queryKey: ["data", session.user.id] });
      }
      return result;
    } catch (error) {
      if (
        error instanceof ApiError &&
        [401, 403].includes(error.status) &&
        error.detail.code !== "CSRF_INVALID"
      ) {
        void query.invalidateQueries({ queryKey: ["session"] });
        void query.invalidateQueries({
          queryKey: customerKeys.root(session.user.id, scope),
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
