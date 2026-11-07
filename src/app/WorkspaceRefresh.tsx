import {
  notifyManager,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { lastReadAt } from "./queryClient";
import { RefreshControl } from "../shared/ui/RefreshControl";
import { hasBlockingReadError } from "../shared/api/read-model";

export function WorkspaceRefresh({
  userId,
  refresh,
}: {
  userId: string;
  refresh: () => void;
}) {
  const cache = useQueryClient().getQueryCache();
  const subscribe = useCallback(
    (listener: () => void) =>
      cache.subscribe(notifyManager.batchCalls(listener)),
    [cache],
  );
  const filters = { queryKey: ["data", userId], type: "active" as const };
  const fetching = useIsFetching(filters);
  const updatedAt = useSyncExternalStore(subscribe, () => {
    const active = cache.findAll(filters);
    const page = active.filter((entry) => entry.queryKey[3] !== "lookups");
    const reads = (page.length ? page : active).filter(
      (entry) => lastReadAt(entry) && !hasBlockingReadError(entry.state),
    );
    // The screen is only as fresh as its oldest displayed result.
    return reads.length ? Math.min(...reads.map(lastReadAt)) : 0;
  });
  const stale = useSyncExternalStore(subscribe, () =>
    cache
      .findAll(filters)
      .some(({ state }) => state.error && !hasBlockingReadError(state)),
  );
  return (
    <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
      {stale && (
        <span role="status" className="text-xs text-muted">
          일부 데이터를 다시 불러오지 못했어요. 마지막 조회 결과를 표시합니다.
        </span>
      )}
      <RefreshControl
        updatedAt={updatedAt}
        fetching={fetching > 0}
        refresh={refresh}
      />
    </div>
  );
}
