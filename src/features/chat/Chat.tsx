import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, MOCK } from "../../shared/api/client";
import { isAccessError } from "../../shared/api/read-model";
import type { Message, ResourceMap } from "../../shared/domain/schema";
import { displayDate } from "../../shared/domain/schema";
import { useApp } from "../../app/context";
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  FieldError,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { RecordPanel } from "../records/ResourcePage";
import { TaskCard } from "./TaskCard";
import { chatApi } from "./api";
import { draftKey as sessionDraftKey } from "./model";
import type { Channel } from "./model";
import { useChatFeed, useVisibleRefresh } from "./hooks";
import { MessageViewport } from "./MessageViewport";
import {
  clearChatChannel,
  reconcileOutgoing,
  transmit,
  useChatSession,
} from "./session";

export function Chat() {
  const { session, scope } = useApp(),
    { channelId } = useParams();
  const key = JSON.stringify([
    session.user.id,
    scope,
    channelId,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  return <ChatWorkspace key={key} />;
}
function ChatWorkspace() {
  const { session, scope, lookups } = useApp(),
    { channelId = "" } = useParams(),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    query = useQueryClient();
  const user = session.user,
    threadId = params.get("thread") || "",
    detail = params.get("detail") || "";
  const drafts = useChatSession((s) => s.drafts),
    setDraft = useChatSession((s) => s.setDraft),
    allOutgoing = useChatSession((s) => s.outgoing);
  const outgoing = allOutgoing.filter(
    (j) => j.userId === user.id && j.scope === scope,
  );
  const [dmError, setDmError] = useState(""),
    [denied, setDenied] = useState(false);
  const channels = useQuery({
    queryKey: ["data", user.id, scope, "chat", "channels"],
    queryFn: ({ signal }) => chatApi.channels(scope, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const channel = channels.data?.find((c) => c.id === channelId),
    enabled = !!channel && !denied && !isAccessError(channels.error);
  const history = useChatFeed(channelId, "", enabled),
    messages = history.messages,
    rootMessages = messages;
  const parent = useQuery({
    queryKey: [
      "data",
      user.id,
      scope,
      "chat",
      "channel",
      channelId,
      "parent",
      threadId,
    ],
    queryFn: ({ signal }) => chatApi.parent(threadId, scope, signal),
    enabled: enabled && !!threadId,
    retry: false,
  });
  const threadHistory = useChatFeed(
      channelId,
      threadId,
      enabled &&
        !!threadId &&
        parent.data?.channelId === channelId &&
        !parent.data.parentId,
      "thread",
    ),
    replies = threadHistory.messages;
  const clearCurrent = useCallback(() => {
    clearChatChannel(user.id, scope, channelId);
    void query.cancelQueries({
      queryKey: ["data", user.id, scope, "chat", "channel", channelId],
    });
    query.removeQueries({
      queryKey: ["data", user.id, scope, "chat", "channel", channelId],
    });
  }, [user.id, scope, channelId, query]);
  const onDenied = useCallback(() => {
    setDenied(true);
    clearCurrent();
  }, [clearCurrent]);
  useEffect(() => {
    if (
      channelId &&
      ((channels.isSuccess && !channel) || isAccessError(channels.error))
    )
      clearCurrent();
  }, [channelId, channels.isSuccess, channel, channels.error, clearCurrent]);
  useEffect(() => {
    reconcileOutgoing(user.id, scope, [...messages, ...replies]);
  }, [user.id, scope, messages, replies]);
  async function refresh() {
    const result = await channels.refetch();
    if (
      !enabled ||
      result.error ||
      !result.data?.some((c) => c.id === channelId)
    )
      return;
    await Promise.all([
      history.refetch(),
      threadId && parent.data?.channelId === channelId
        ? threadHistory.refetch()
        : Promise.resolve(),
      threadId ? parent.refetch() : Promise.resolve(),
    ]);
  }
  useVisibleRefresh(refresh);
  const person = (id: string) =>
    lookups.employees.find((e) => e.id === id)?.name || id;
  function name(c: Channel) {
    return c.kind === "dm"
      ? person(c.participantIds.find((id) => id !== user.id) || "")
      : c.name;
  }
  const draftKey = (parentId: string) =>
    sessionDraftKey(user.id, scope, channelId, parentId);
  function send(parentId: string) {
    const text = (drafts[draftKey(parentId)] || "").trim();
    if (
      !enabled ||
      !text ||
      outgoing.some(
        (j) =>
          j.channelId === channelId &&
          j.parentId === parentId &&
          j.state === "sending",
      )
    )
      return;
    const retry = outgoing.find(
      (j) =>
        j.channelId === channelId &&
        j.parentId === parentId &&
        j.text === text &&
        j.state === "failed",
    );
    void transmit(
      retry ?? {
        userId: user.id,
        scope,
        channelId,
        parentId,
        text,
        clientMessageId: crypto.randomUUID(),
        state: "sending",
      },
      query,
    );
  }
  function composer(parentId: string) {
    const key = draftKey(parentId);
    return (
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(parentId);
        }}
      >
        <label className="sr-only" htmlFor={`composer-${parentId || "main"}`}>
          {parentId ? "스레드 답글" : "메시지"}
        </label>
        <textarea
          id={`composer-${parentId || "main"}`}
          aria-label={parentId ? "스레드 답글" : "메시지"}
          placeholder={
            parentId
              ? "처리 결과를 답글로 남겨 주세요"
              : `#${channel ? name(channel) : ""}에 메시지 보내기`
          }
          maxLength={4000}
          value={drafts[key] || ""}
          onChange={(e) => setDraft(key, e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              send(parentId);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <small className="text-[9px]">Enter 전송 · Shift+Enter 줄바꿈</small>
          <Button
            variant="primary"
            type="submit"
            disabled={
              !drafts[key]?.trim() ||
              outgoing.some(
                (j) =>
                  j.channelId === channelId &&
                  j.parentId === parentId &&
                  j.state === "sending",
              )
            }
          >
            보내기 <Icon name="send" size={14} />
          </Button>
        </div>
      </form>
    );
  }
  function bubble(m: Message, inThread = false) {
    return (
      <article className="message" key={m.id} data-message-id={m.id}>
        <Avatar name={person(m.authorId)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-xs">{person(m.authorId)}</b>
            <time className="text-[10px] text-muted" dateTime={m.createdAt}>
              {displayDate(m.createdAt)}
            </time>
          </div>
          <p>{m.taskId ? "업무를 공유했어요." : m.text}</p>
          {m.taskId && (
            <TaskCard
              id={m.taskId}
              onOpen={() =>
                setParams((p) => {
                  p.set("detail", m.taskId);
                  return p;
                })
              }
            />
          )}{" "}
          {!inThread && (
            <button
              className="mt-2 flex items-center gap-1 text-[11px] text-primary"
              onClick={() =>
                setParams((p) => {
                  p.set("thread", m.id);
                  return p;
                })
              }
            >
              <Icon name="chat" size={13} />
              답글 달기
            </button>
          )}
        </div>
      </article>
    );
  }
  function pending(parentId: string) {
    return outgoing
      .filter(
        (j) =>
          j.channelId === channelId &&
          j.parentId === parentId &&
          ![...messages, ...replies].some(
            (m) =>
              m.clientMessageId === j.clientMessageId && m.authorId === user.id,
          ),
      )
      .map((j) => (
        <article className="message" key={j.clientMessageId}>
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <b className="text-xs">{user.name}</b>
            <p>{j.text}</p>
            <small>{j.state === "sending" ? "전송 중…" : "전송 실패"}</small>
            {j.error && <p className="text-xs text-red-700">{j.error}</p>}
            {j.state === "failed" && (
              <>
                <Button onClick={() => void transmit(j, query)}>재전송</Button>
                <Button
                  onClick={() =>
                    useChatSession.getState().remove(j.clientMessageId)
                  }
                >
                  삭제
                </Button>
              </>
            )}
          </div>
        </article>
      ));
  }
  return (
    <div className={`chat-shell ${channelId ? "has-channel" : ""}`}>
      <aside className="chat-list">
        <header className="chat-header">
          <h2>팀 채팅</h2>
          <Button
            aria-label="채팅 새로고침"
            disabled={
              channels.isFetching ||
              history.isFetching ||
              threadHistory.isFetching
            }
            onClick={() => {
              setDenied(false);
              void refresh();
            }}
          >
            <Icon name="refresh" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="nav-label">채널</p>
          {channels.isSuccess && !channels.data.length && (
            <State title="아직 참여 중인 대화가 없어요" />
          )}
          {channels.isPending ? (
            <State loading />
          ) : channels.error ? (
            <ErrorState
              error={channels.error}
              retry={() => void channels.refetch()}
            />
          ) : (
            channels.data
              ?.filter((c) => c.kind === "channel")
              .map((c) => (
                <Link
                  key={c.id}
                  className={`nav-link ${c.id === channelId ? "active" : ""}`}
                  to={`/app/${scope}/chat/${c.id}`}
                >
                  <span className="text-lg">#</span>
                  <span className="min-w-0 flex-1 truncate">{name(c)}</span>
                  {c.unread > 0 && <Badge>{c.unread}</Badge>}
                </Link>
              ))
          )}
          {MOCK && (
            <>
              <p className="nav-label">다이렉트 메시지</p>
              {channels.data
                ?.filter((c) => c.kind === "dm")
                .map((c) => (
                  <Link
                    key={c.id}
                    className={`nav-link ${c.id === channelId ? "active" : ""}`}
                    to={`/app/${scope}/chat/${c.id}`}
                  >
                    <Avatar name={name(c)} />
                    <span className="min-w-0 flex-1 truncate">{name(c)}</span>
                    {c.unread > 0 && <Badge>{c.unread}</Badge>}
                  </Link>
                ))}
              <label className="field mt-5 px-2">
                <span>동료에게 메시지</span>
                <select
                  aria-label="DM 시작할 동료"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDmError("");
                    void api<ResourceMap["channels"]>("/chat/dm", {
                      method: "POST",
                      body: { employeeId: e.target.value },
                      key: crypto.randomUUID(),
                    })
                      .then(async (c) => {
                        await query.invalidateQueries({ queryKey: ["data"] });
                        navigate(`/app/${scope}/chat/${c.id}`);
                      })
                      .catch((e) => setDmError(e.message));
                  }}
                >
                  <option value="">동료 선택</option>
                  {lookups.employees
                    .filter((e) => e.id !== user.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              {dmError && <FieldError>{dmError}</FieldError>}
            </>
          )}
        </div>
        <div className="border-t border-line p-4 text-[10px] text-muted">
          업무 AI는 별도 메뉴에서 이용해요.
        </div>
      </aside>
      <section className={`chat-main ${threadId ? "thread-open" : ""}`}>
        {!channelId ? (
          <State
            title="대화로 이어지는 업무"
            message="채널이나 동료를 선택해 이야기를 시작해 보세요."
          />
        ) : denied ||
          (channels.data && !channel) ||
          isAccessError(channels.error) ? (
          <State
            title="접근할 수 없는 대화예요"
            message="참여 중인 채널 또는 DM을 선택해 주세요."
            action={
              <Button onClick={() => navigate(`/app/${scope}/chat`)}>
                대화 목록
              </Button>
            }
          />
        ) : (
          <>
            <header className="chat-header">
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  className="sm:hidden"
                  to={`/app/${scope}/chat`}
                  aria-label="대화 목록으로"
                >
                  <Icon name="arrow" className="rotate-180" />
                </Link>
                <div className="min-w-0">
                  <h2 className="truncate">
                    {channel?.kind === "channel" ? "# " : ""}
                    {channel && name(channel)}
                  </h2>
                  <small className="block truncate text-[10px]">
                    {channel?.description}
                  </small>
                </div>
              </div>
              <small className="shrink-0">
                {channel?.participantIds.length}명 참여
              </small>
            </header>
            <MessageViewport
              key={`${channelId}:main`}
              feed={history}
              channelId={channelId}
              parentId=""
              onDenied={onDenied}
            >
              <div className="my-3 flex items-center gap-3 text-[10px] text-muted">
                <span className="h-px flex-1 bg-line" />
                팀의 이야기가 시작되는 곳
                <span className="h-px flex-1 bg-line" />
              </div>
              {rootMessages.map((m) => bubble(m))}
              {!history.isPending && !history.error && !rootMessages.length && (
                <State title="첫 이야기를 남겨 주세요" />
              )}
              {pending("")}
            </MessageViewport>
            {composer("")}
          </>
        )}
      </section>
      {threadId && enabled && (
        <aside className="thread" aria-label="스레드">
          <header className="chat-header">
            <h2>스레드</h2>
            <Button
              aria-label="스레드 닫기"
              onClick={() =>
                setParams((p) => {
                  p.delete("thread");
                  return p;
                })
              }
            >
              <Icon name="close" size={17} />
            </Button>
          </header>
          {parent.isPending ? (
            <div className="messages">
              <State loading />
            </div>
          ) : parent.error ? (
            <div className="messages">
              <ErrorState error={parent.error} />
            </div>
          ) : parent.data?.channelId === channelId && !parent.data.parentId ? (
            <MessageViewport
              key={`${channelId}:${threadId}`}
              feed={threadHistory}
              channelId={channelId}
              parentId={threadId}
              onDenied={onDenied}
            >
              {bubble(parent.data, true)}
              <div className="my-3 border-t border-line pt-3 text-xs text-muted">
                불러온 답글 {replies.length}개
              </div>
              {replies.map((m) => bubble(m, true))}
              {pending(threadId)}
            </MessageViewport>
          ) : (
            <FieldError>이 대화의 스레드가 아닙니다.</FieldError>
          )}
          {!parent.error &&
            parent.data?.channelId === channelId &&
            !parent.data.parentId &&
            composer(threadId)}
        </aside>
      )}
      {detail && enabled && (
        <RecordPanel
          resource="tasks"
          id={detail}
          onClose={() =>
            setParams((p) => {
              p.delete("detail");
              return p;
            })
          }
        />
      )}
    </div>
  );
}
