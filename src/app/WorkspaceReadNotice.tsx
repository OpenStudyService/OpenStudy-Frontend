import { notifyManager, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { hasBlockingReadError } from "../shared/api/read-model";

export function WorkspaceReadNotice({ userId }: { userId: string }) {
  const cache = useQueryClient().getQueryCache();
  const subscribe = useCallback(
    (listener: () => void) =>
      cache.subscribe(notifyManager.batchCalls(listener)),
    [cache],
  );
  const stale = useSyncExternalStore(subscribe, () =>
    cache
      .findAll({ queryKey: ["data", userId], type: "active" })
      .some(({ state }) => state.error && !hasBlockingReadError(state)),
  );
  if (!stale) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
      <span role="status" className="text-xs text-muted">
        일부 데이터를 다시 불러오지 못했어요. 마지막 조회 결과를 표시합니다.
      </span>
    </div>
  );
}
