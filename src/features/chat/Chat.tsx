import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { Message, ResourceMap, Task } from "../../shared/domain/schema";
import { displayDate } from "../../shared/domain/schema";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
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
type Channel = ResourceMap["channels"] & { unread: number };
type Messages = { items: Message[]; nextCursor?: string; total: number };
interface Outgoing {
  clientMessageId: string;
  channelId: string;
  parentId: string;
  text: string;
  state: "sending" | "failed";
  error?: string;
}
export function Chat() {
  const { session, scope, lookups } = useApp(),
    { channelId } = useParams(),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    query = useQueryClient();
  const user = session.user,
    threadId = params.get("thread") || "",
    detail = params.get("detail") || "",
    setDraft = useUi((s) => s.setDraft),
    drafts = useUi((s) => s.drafts);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]),
    [dmError, setDmError] = useState(""),
    [atBottom, setAtBottom] = useState(true);
  const readRef = useRef<Record<string, number>>({}),
    scroll = useRef<HTMLDivElement>(null);
  const channels = useQuery({
    queryKey: ["data", user.id, scope, "chat", "channels"],
    queryFn: ({ signal }) =>
      api<Channel[]>(`/chat/channels?scope=${scope}`, { signal }),
    retry: false,
  });
  const channel = channels.data?.find((c) => c.id === channelId),
    enabled = !!channel;
  const history = useInfiniteQuery({
    queryKey: ["data", user.id, scope, "chat", "messages", channelId],
    queryFn: ({ signal, pageParam }) =>
      api<Messages>(
        `/chat/${channelId}/messages${pageParam ? `?before=${pageParam}` : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    retry: false,
  });
  const messages = [
      ...new Map(
        (history.data?.pages.flatMap((p) => p.items) || []).map((m) => [
          m.id,
          m,
        ]),
      ).values(),
    ].sort((a, b) => a.sequence - b.sequence),
    highest = messages.at(-1)?.sequence || 0;
  const parent = useQuery({
    queryKey: ["data", user.id, scope, "chat", "thread-parent", threadId],
    queryFn: ({ signal }) =>
      api<Message>(`/messages/${threadId}?scope=${scope}`, { signal }),
    enabled: enabled && !!threadId,
    retry: false,
  });
  const threadHistory = useInfiniteQuery({
    queryKey: ["data", user.id, scope, "chat", "replies", channelId, threadId],
    queryFn: ({ signal, pageParam }) =>
      api<Messages>(
        `/chat/${channelId}/messages?parent=${encodeURIComponent(threadId)}${pageParam ? `&before=${pageParam}` : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && !!threadId,
  });
  const replies = [
      ...new Map(
        (threadHistory.data?.pages.flatMap((p) => p.items) || []).map((m) => [
          m.id,
          m,
        ]),
      ).values(),
    ].sort((a, b) => a.sequence - b.sequence),
    rootMessages = messages.filter((m) => !m.parentId);
  useEffect(() => {
    if (
      !channelId ||
      !highest ||
      !atBottom ||
      document.visibilityState !== "visible"
    )
      return;
    const key = `${user.id}:${channelId}`;
    if ((readRef.current[key] || 0) >= highest) return;
    readRef.current[key] = highest;
    void api(`/chat/${channelId}/read`, {
      method: "POST",
      body: { sequence: highest },
    })
      .then(() =>
        query.invalidateQueries({
          queryKey: ["data", user.id, scope, "chat", "channels"],
        }),
      )
      .catch(() => {
        readRef.current[key] = 0;
      });
  }, [channelId, highest, atBottom, user.id, scope, query]);
  useEffect(() => {
    if (atBottom && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [highest, channelId, atBottom]);
  const person = (id: string) =>
    lookups.employees.find((e) => e.id === id)?.name || id;
  function name(c: Channel) {
    return c.kind === "dm"
      ? person(c.participantIds.find((id) => id !== user.id) || "")
      : c.name;
  }
  const draftKey = (parentId: string) => `${user.id}:${channelId}:${parentId}`;
  async function transmit(job: Outgoing) {
    setOutgoing((old) => [
      ...old.filter((j) => j.clientMessageId !== job.clientMessageId),
      { ...job, state: "sending" },
    ]);
    try {
      await api<Message>(`/chat/${job.channelId}/messages`, {
        method: "POST",
        body: {
          text: job.text,
          parentId: job.parentId,
          taskId: "",
          clientMessageId: job.clientMessageId,
        },
        key: job.clientMessageId,
      });
      setOutgoing((old) =>
        old.filter((j) => j.clientMessageId !== job.clientMessageId),
      );
      const key = `${user.id}:${job.channelId}:${job.parentId}`;
      if (useUi.getState().drafts[key] === job.text) setDraft(key, "");
      await query.invalidateQueries({ queryKey: ["data"] });
    } catch (e) {
      setOutgoing((old) =>
        old.map((j) =>
          j.clientMessageId === job.clientMessageId
            ? { ...j, state: "failed", error: (e as Error).message }
            : j,
        ),
      );
    }
  }
  function send(parentId: string) {
    const key = draftKey(parentId),
      text = (drafts[key] || "").trim();
    if (
      !text ||
      !channelId ||
      outgoing.some(
        (j) =>
          j.channelId === channelId &&
          j.parentId === parentId &&
          j.state === "sending",
      )
    )
      return;
    void transmit({
      clientMessageId: crypto.randomUUID(),
      channelId,
      parentId,
      text,
      state: "sending",
    });
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
      <article className="message" key={m.id}>
        <Avatar name={person(m.authorId)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-xs">{person(m.authorId)}</b>
            <time className="text-[10px] text-muted" dateTime={m.createdAt}>
              {displayDate(m.createdAt)}
            </time>
          </div>
          <p>{m.text}</p>
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
              {messages.filter((r) => r.parentId === m.id).length
                ? `답글 ${messages.filter((r) => r.parentId === m.id).length}개`
                : "답글 달기"}
            </button>
          )}
        </div>
      </article>
    );
  }
  function pending(parentId: string) {
    return outgoing
      .filter((j) => j.channelId === channelId && j.parentId === parentId)
      .map((j) => (
        <article className="message" key={j.clientMessageId}>
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <b className="text-xs">{user.name}</b>
            <p>{j.text}</p>
            <small>{j.state === "sending" ? "전송 중…" : "전송 실패"}</small>
            {j.error && <p className="text-xs text-red-700">{j.error}</p>}
            {j.state === "failed" && (
              <Button onClick={() => void transmit(j)}>재전송</Button>
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
          <Icon name="chat" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="nav-label">채널</p>
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
        ) : channels.data && !channel ? (
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
            <div
              className="messages"
              ref={scroll}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAtBottom(
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80,
                );
              }}
            >
              {history.isPending ? (
                <State loading />
              ) : history.error ? (
                <ErrorState
                  error={history.error}
                  retry={() => void history.refetch()}
                />
              ) : (
                <>
                  {history.hasNextPage && (
                    <Button
                      className="mx-auto mb-4 flex"
                      onClick={() => void history.fetchNextPage()}
                      disabled={history.isFetchingNextPage}
                    >
                      이전 메시지 불러오기
                    </Button>
                  )}
                  <div className="my-3 flex items-center gap-3 text-[10px] text-muted">
                    <span className="h-px flex-1 bg-line" />
                    팀의 이야기가 시작되는 곳
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  {rootMessages.map((m) => bubble(m))}
                  {!rootMessages.length && (
                    <State title="첫 이야기를 남겨 주세요" />
                  )}
                  {pending("")}
                </>
              )}
            </div>
            {composer("")}
          </>
        )}
      </section>
      {threadId && channel && (
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
          <div className="messages">
            {parent.isPending ? (
              <State loading />
            ) : parent.error ? (
              <ErrorState error={parent.error} />
            ) : parent.data?.channelId === channelId ? (
              <>
                {bubble(parent.data, true)}
                <div className="my-3 border-t border-line pt-3 text-xs text-muted">
                  답글 {replies.length}개
                </div>
                {threadHistory.isPending && <State loading />}
                {threadHistory.error && (
                  <ErrorState
                    error={threadHistory.error}
                    retry={() => void threadHistory.refetch()}
                  />
                )}
                {threadHistory.hasNextPage && (
                  <Button onClick={() => void threadHistory.fetchNextPage()}>
                    이전 답글 불러오기
                  </Button>
                )}
                {replies.map((m) => bubble(m, true))}
                {pending(threadId)}
              </>
            ) : (
              <FieldError>이 대화의 스레드가 아닙니다.</FieldError>
            )}
          </div>
          {parent.data?.channelId === channelId && composer(threadId)}
        </aside>
      )}
      {detail && (
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
function TaskCard({ id, onOpen }: { id: string; onOpen: () => void }) {
  const { session, scope } = useApp();
  const task = useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "detail", id],
    queryFn: ({ signal }) =>
      api<Task>(`/tasks/${id}?scope=${scope}`, { signal }),
    retry: false,
  });
  return (
    <button className="task-card" onClick={onOpen}>
      <span className="flex items-center gap-2 text-[10px] text-muted">
        <Icon name="tasks" size={14} />
        연결된 업무
      </span>
      <b className="my-2 block text-[13px] text-primary">
        {task.data?.title ||
          (task.error ? "접근할 수 없는 업무" : "업무를 확인하고 있어요")}
      </b>
      {task.data && (
        <div className="flex justify-between">
          <small className="text-[10px]">기한 {task.data.due}</small>
          <Badge>{task.data.status}</Badge>
        </div>
      )}
    </button>
  );
}
