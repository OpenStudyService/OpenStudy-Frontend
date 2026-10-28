import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { chatApi } from "./api";
import { mergeMessages, refreshFeed } from "./model";
import type { MessageFeed } from "./model";

export function useVisibleRefresh(
  refresh: () => Promise<unknown>,
  enabled = true,
) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let busy = false,
      stopped = false;
    const run = async () => {
      if (busy || stopped || document.visibilityState !== "visible") return;
      busy = true;
      try {
        await latest.current();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void run(), 15000);
    const visible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [enabled]);
}
export function useChatFeed(
  channelId: string,
  parentId: string,
  enabled: boolean,
  lane: "main" | "thread" = "main",
) {
  const { session, scope } = useApp(),
    client = useQueryClient();
  const key = useMemo(
    () => [
      "data",
      session.user.id,
      scope,
      "chat",
      "channel",
      channelId,
      "feed",
      lane,
      parentId,
    ],
    [session.user.id, scope, channelId, parentId, lane],
  );
  const feed = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const refreshed = await refreshFeed(
        client.getQueryData<MessageFeed>(key),
        (cursor) => chatApi.messages(channelId, parentId, signal, cursor),
      );
      const current = client.getQueryData<MessageFeed>(key);
      return {
        items: mergeMessages(current?.items ?? [], refreshed.items),
        nextCursor:
          current?.items.length &&
          current.items[0].sequence < (refreshed.items[0]?.sequence ?? Infinity)
            ? current.nextCursor
            : refreshed.nextCursor,
      };
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const token = JSON.stringify(key);
  const [olderState, setOlderState] = useState<{
    token: string;
    pending: boolean;
    error: Error | null;
  }>({ token: "", pending: false, error: null });
  const older = olderState.token === token && olderState.pending;
  const olderError = olderState.token === token ? olderState.error : null;
  const locks = useRef(new Set<string>());
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key });
    },
    [client, key],
  );
  async function fetchNextPage() {
    const cursor = feed.data?.nextCursor;
    if (!cursor || locks.current.has(token) || feed.isFetching) return;
    locks.current.add(token);
    setOlderState({ token, pending: true, error: null });
    let requestSignal: AbortSignal | undefined;
    try {
      const page = await client.fetchQuery({
        queryKey: [...key, "older", cursor],
        queryFn: ({ signal }) => {
          requestSignal = signal;
          return chatApi.messages(channelId, parentId, signal, cursor);
        },
        retry: false,
        staleTime: 0,
      });
      if (page.nextCursor === cursor)
        throw new Error("메시지 커서가 반복됩니다. 다시 조회해 주세요.");
      client.setQueryData<MessageFeed>(key, (old) => ({
        items: mergeMessages(page.items, old?.items ?? []),
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!requestSignal?.aborted)
        setOlderState((old) =>
          old.token === token ? { ...old, error: error as Error } : old,
        );
    } finally {
      locks.current.delete(token);
      setOlderState((old) =>
        old.token === token ? { ...old, pending: false } : old,
      );
    }
  }
  return {
    ...feed,
    messages: feed.data?.items ?? [],
    hasNextPage: !!feed.data?.nextCursor,
    fetchNextPage,
    isFetchingNextPage: older,
    olderError,
  };
}
export type ChatFeed = ReturnType<typeof useChatFeed>;
