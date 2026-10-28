import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { isAccessError } from "../../shared/api/read-model";
import { ApiError } from "../../shared/api/client";
import {
  Button,
  ErrorState,
  FieldError,
  State,
} from "../../shared/ui/primitives";
import { chatApi } from "./api";
import type { ChatFeed } from "./hooks";

export function MessageViewport({
  feed,
  channelId,
  parentId,
  children,
  onDenied,
}: {
  feed: ChatFeed;
  channelId: string;
  parentId: string;
  children: ReactNode;
  onDenied: () => void;
}) {
  const { session, scope } = useApp(),
    client = useQueryClient();
  const viewport = useRef<HTMLDivElement>(null),
    last = useRef<HTMLDivElement>(null),
    bottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true),
    [readError, setReadError] = useState<Error | null>(null),
    [retryRead, setRetryRead] = useState(0);
  const ack = useRef(0),
    writing = useRef(false);
  const highest = feed.messages.at(-1)?.sequence ?? 0;
  useEffect(() => {
    if (isAccessError(feed.error) || isAccessError(feed.olderError)) onDenied();
  }, [feed.error, feed.olderError, onDenied]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (anchor.current && !feed.isFetchingNextPage) {
      element.scrollTop =
        anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (bottom.current && !anchor.current)
      element.scrollTop = element.scrollHeight;
  }, [feed.dataUpdatedAt, feed.isFetchingNextPage]);
  useEffect(() => {
    const element = viewport.current,
      sentinel = last.current;
    if (
      !element ||
      !sentinel ||
      !highest ||
      feed.isFetching ||
      feed.error ||
      feed.olderError
    )
      return;
    const controller = new AbortController();
    const measure = () => {
      const box = element.getBoundingClientRect(),
        end = sentinel.getBoundingClientRect();
      if (
        document.visibilityState !== "visible" ||
        !element.clientHeight ||
        !element.getClientRects().length ||
        end.bottom > box.bottom + 1 ||
        end.top < box.top ||
        ack.current >= highest ||
        writing.current
      )
        return;
      writing.current = true;
      void chatApi
        .read(channelId, parentId, highest, controller.signal)
        .then(() => {
          controller.signal.throwIfAborted();
          ack.current = Math.max(ack.current, highest);
          setReadError(null);
          void client.invalidateQueries({
            queryKey: ["data", session.user.id, scope, "chat", "channels"],
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setReadError(error as Error);
            if (
              isAccessError(error) &&
              !(
                error instanceof ApiError &&
                error.detail.code === "CSRF_INVALID"
              )
            )
              onDenied();
          }
        })
        .finally(() => {
          writing.current = false;
        });
    };
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(measure, { root: element, threshold: 1 })
        : undefined;
    observer?.observe(sentinel);
    const resized =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    resized?.observe(element);
    const frame = requestAnimationFrame(measure);
    element.addEventListener("scroll", measure);
    document.addEventListener("visibilitychange", measure);
    window.addEventListener("focus", measure);
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resized?.disconnect();
      element.removeEventListener("scroll", measure);
      document.removeEventListener("visibilitychange", measure);
      window.removeEventListener("focus", measure);
    };
  }, [
    channelId,
    parentId,
    highest,
    feed.dataUpdatedAt,
    feed.isFetching,
    feed.error,
    feed.olderError,
    client,
    session.user.id,
    scope,
    retryRead,
    onDenied,
  ]);
  async function previous() {
    if (viewport.current)
      anchor.current = {
        height: viewport.current.scrollHeight,
        top: viewport.current.scrollTop,
      };
    await feed.fetchNextPage();
  }
  return (
    <div
      className="messages"
      ref={viewport}
      onScroll={(event) => {
        const e = event.currentTarget;
        bottom.current = e.scrollHeight - e.scrollTop - e.clientHeight <= 2;
        setAtBottom(bottom.current);
      }}
    >
      {feed.isPending ? (
        <State loading />
      ) : isAccessError(feed.error) ? (
        <ErrorState error={feed.error!} />
      ) : (
        <>
          {feed.error && (
            <ErrorState error={feed.error} retry={() => void feed.refetch()} />
          )}
          {feed.olderError && (
            <ErrorState error={feed.olderError} retry={() => void previous()} />
          )}
          {feed.hasNextPage && (
            <Button
              className="mx-auto mb-4 flex"
              onClick={() => void previous()}
              disabled={feed.isFetchingNextPage || feed.isFetching}
            >
              {parentId ? "이전 답글 불러오기" : "이전 메시지 불러오기"}
            </Button>
          )}
          {children}
          <div ref={last} aria-hidden="true" style={{ height: 1 }} />
          {!atBottom && (
            <Button
              className="sticky bottom-0"
              onClick={() => {
                if (viewport.current)
                  viewport.current.scrollTop = viewport.current.scrollHeight;
              }}
            >
              새 메시지로 이동
            </Button>
          )}
          {readError && (
            <div role="status">
              <FieldError>읽음 상태를 저장하지 못했어요.</FieldError>
              <Button onClick={() => setRetryRead((n) => n + 1)}>
                읽음 다시 시도
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
