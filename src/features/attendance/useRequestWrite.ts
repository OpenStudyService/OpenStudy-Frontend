import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { createRequest } from "./request-api";

export function useRequestWrite(...reads: string[]) {
  const { session } = useApp();
  const query = useQueryClient();
  const keys = useIdempotency();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run(write: () => Promise<unknown>, saved?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await write();
      saved?.();
      await invalidateReads(query, session.user.id, ...reads);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function create<T>(path: string, body: T, saved: () => void) {
    return run(
      () => createRequest(path, body, keys.key(path, body)),
      () => {
        keys.committed();
        saved();
      },
    );
  }

  return { busy, error, run, create };
}
