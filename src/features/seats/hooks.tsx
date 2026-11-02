import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { seatApi } from "./api";

export function useSeatBoard(branchId: string, kind = "") {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "seats",
      "board",
      branchId,
      kind,
    ],
    queryFn: ({ signal }) => seatApi.board(branchId, kind, signal),
    enabled: !!branchId && branchId !== "all",
    retry: false,
  });
}
export function useSeatOccupancy() {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "seats", "occupancy"],
    queryFn: ({ signal }) => seatApi.occupancy(scope, signal),
    retry: false,
  });
}
export function useSeatDetail(id: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "seats", "detail", id],
    queryFn: ({ signal }) => seatApi.detail(scope, id, signal),
    enabled: !!id && id !== "new",
    retry: false,
  });
}
export function useSeatSession(id: string) {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "seat-sessions", "detail", id],
    queryFn: ({ signal }) => seatApi.session(scope, id, signal),
    enabled: !!id,
    retry: false,
  });
}
export function useSeatWrite() {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const permissionKey = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef<AbortController | null>(null);
  const [state, setState] = useState({ key: permissionKey, busy: false });
  const idempotency = useIdempotency();
  const keys = useRef(idempotency);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    lock.current = null;
    keys.current.committed();
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
    setState({ key: permissionKey, busy: true });
    // Capture the initiating user: a later account/scope change cannot retarget invalidation.
    const refresh = () => {
      void query.invalidateQueries({ queryKey: ["data", session.user.id] });
    };
    try {
      const result = await request(
        current.signal,
        keys.current.key(operation, body),
      );
      current.signal.throwIfAborted();
      if (commit) {
        keys.current.committed();
        refresh();
      }
      return result;
    } catch (error) {
      // Even a failed/aborted response may follow a committed server write.
      if (commit) refresh();
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        void query.invalidateQueries({ queryKey: ["session"] });
        if (!commit) refresh();
      }
      throw error;
    } finally {
      if (lock.current === current) {
        lock.current = null;
        if (!current.signal.aborted)
          setState({ key: permissionKey, busy: false });
      }
    }
  }
  return { run, busy: state.key === permissionKey && state.busy };
}
