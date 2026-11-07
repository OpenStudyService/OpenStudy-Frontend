import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, MOCK } from "../../shared/api/client";
import { can, displayDate, won } from "../../shared/domain/schema";
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
import { ViewSpecRenderer } from "./Charts";
import {
  aiConversations,
  executeAiQuery,
  parseAiResult,
  POC_QUESTIONS,
  toViewMode,
} from "./domainlens";
import type {
  AiConversationSummary,
  AiQueryResponseDto,
  ClarificationOptionDto,
  ParsedAiResult,
  PocQuestionSpec,
  StageSpanDto,
} from "./domainlens";

/**
 * One question and its answer. The turns stay in one log, and the server keeps them in one conversation through
 * conversationId (listing and reopening saved conversations: #71).
 */
interface Turn {
  id: string;
  question: string;
  askedAt: string;
  state: "loading" | "completed" | "clarification" | "refused" | "error";
  parsed: ParsedAiResult | null;
  view: string;
  message: string;
  options: ClarificationOptionDto[];
  /** The engine's own stage record, returned with the answer (the query runs in one request, not streamed). */
  stages: StageSpanDto[];
  elapsedMs: number;
}

const DOMAINS = ["전체", "매출", "좌석", "이용권", "스터디룸", "업무", "근태"];
const MAX_QUESTION = 1000;

/**
 * The AI chat (DomainLens natural-language reads). A refused answer explains itself; it never shows partial data.
 * A scope or account change starts a new conversation (the key), since earlier answers were read under other
 * permissions.
 */
export function Ai() {
  const { session, scope } = useApp();
  return <AiChat key={`${session.user.id}:${scope}`} />;
}

function AiChat() {
  const { session, scope } = useApp();
  const user = session.user;
  const allowed = can(user, scope, "ai:read");
  const salesAllowed = can(user, scope, "sales:read");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [domain, setDomain] = useState("전체");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Phones show either the history or the conversation (the team chat's list/main switch).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const historyKey = ["data", user.id, scope, "ai", "conversations"];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => aiConversations.list(signal),
    enabled: allowed,
    retry: false,
  });
  const readiness = useQuery({
    queryKey: ["data", user.id, scope, "ai", "readiness"],
    queryFn: ({ signal }) =>
      api<{ ready: boolean; message?: string }>("/catalog/readiness", {
        signal,
      }),
    enabled: allowed,
    retry: false,
  });
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  function patch(id: string, next: Partial<Turn>) {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...next } : t)));
  }

  async function ask(text: string, clarificationChoice?: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !readiness.data?.ready) return;
    const turn = emptyTurn(trimmed, new Date().toISOString());
    const id = turn.id;
    setTurns((all) => [...all, turn]);
    setQuestion("");
    setSuggestionsOpen(false);
    setBusy(true);
    const started = performance.now();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await executeAiQuery(
        { question: trimmed, scope, clarificationChoice, conversationId },
        controller.signal,
      );
      if (res.conversationId) setConversationId(res.conversationId);
      patch(id, {
        ...outcome(res),
        elapsedMs: Math.round(performance.now() - started),
      });
      void client.invalidateQueries({ queryKey: historyKey });
    } catch (e) {
      if (controller.signal.aborted)
        patch(id, { state: "error", message: "질문을 취소했어요." });
      else
        patch(id, {
          state: "error",
          message: (e as Error).message || "AI 조회에 실패했어요.",
        });
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(false);
    }
  }

  function startNew() {
    abort.current?.abort();
    setTurns([]);
    setQuestion("");
    setConversationId(undefined);
    setReopenError("");
    setHistoryOpen(false);
  }

  /** Reopens a saved conversation: the server re-runs its questions under the current permissions and as-of time. */
  async function reopen(id: string) {
    if (busy || reopening) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setReopening(true);
    setReopenError("");
    setHistoryOpen(false);
    setTurns([]);
    setConversationId(id);
    try {
      const saved = await aiConversations.reopen(id, scope, controller.signal);
      setTurns(
        saved.turns.map((t) => ({
          ...emptyTurn(t.question, t.askedAt),
          ...outcome(t.response),
        })),
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setConversationId(undefined);
        setReopenError((e as Error).message || "대화를 열지 못했어요.");
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setReopening(false);
    }
  }

  async function rename(id: string, title: string) {
    await aiConversations.rename(id, title);
    await client.invalidateQueries({ queryKey: historyKey });
  }

  async function remove(id: string) {
    await aiConversations.remove(id);
    if (id === conversationId) startNew();
    await client.invalidateQueries({ queryKey: historyKey });
  }

  if (!allowed)
    return (
      <State
        title="AI 조회 권한이 필요해요"
        message="관리자에게 현재 지점의 AI 조회 권한을 확인해 주세요."
      />
    );
  const ready = Boolean(readiness.data?.ready);
  const examples = POC_QUESTIONS.filter(
    (q) => domain === "전체" || q.domain === domain,
  );
  return (
    // has-channel shows the conversation on phones; without it the history list is shown (as in the team chat).
    <div className={`chat-shell ${historyOpen ? "" : "has-channel"}`}>
      <History
        conversations={history.data}
        loading={history.isPending}
        error={history.error}
        retry={() => void history.refetch()}
        activeId={conversationId}
        disabled={busy || reopening}
        onNew={startNew}
        onOpen={(id) => void reopen(id)}
        onRename={rename}
        onRemove={remove}
      />
      <section className="chat-main" aria-labelledby="ai-chat-title">
        <header className="chat-header">
          <div className="min-w-0">
            <h2 id="ai-chat-title">업무 AI</h2>
            <p className="help">
              허용된 지점과 지표 안에서 운영 데이터를 조회해 표와 차트로
              정리해요.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge>{MOCK ? "AI 응답 모킹" : "DomainLens"}</Badge>
            <Button className="sm:hidden" onClick={() => setHistoryOpen(true)}>
              대화 기록
            </Button>
          </div>
        </header>
        <div className="messages" aria-live="polite">
          {readiness.error ? (
            <ErrorState
              error={readiness.error}
              retry={() => void readiness.refetch()}
            />
          ) : readiness.data && !ready ? (
            <div className="tip mb-4 flex flex-wrap items-center gap-3">
              AI 엔진이 아직 준비되지 않았어요.
              <Button onClick={() => void readiness.refetch()}>
                다시 확인
              </Button>
            </div>
          ) : null}
          {MOCK && (
            <p className="tip mb-4">
              가상 데이터로 만든 모킹 응답이에요. 실제 DomainLens 엔진과 DB에는
              연결되지 않았어요.
            </p>
          )}
          {reopenError && (
            <div className="mb-4">
              <FieldError>{reopenError}</FieldError>
            </div>
          )}
          {reopening ? (
            <State
              loading
              title="대화를 다시 여는 중이에요"
              message="저장된 질문을 지금 권한과 기준 시각으로 다시 조회하고 있어요."
            />
          ) : turns.length === 0 && conversationId ? (
            <State
              title="이 대화에 다시 볼 질문이 없어요"
              message="아래에서 이어서 질문해 보세요."
            />
          ) : turns.length === 0 ? (
            <Examples
              domain={domain}
              setDomain={setDomain}
              examples={examples}
              salesAllowed={salesAllowed}
              disabled={!ready || busy}
              onPick={(q) => void ask(q.question)}
            />
          ) : (
            turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                userName={user.name}
                scope={scope}
                disabled={busy}
                onView={(view) => patch(turn.id, { view })}
                onChoose={(option) => void ask(option.label, option.id)}
              />
            ))
          )}
          <div ref={bottom} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          {suggestionsOpen && (
            <Suggestions
              salesAllowed={salesAllowed}
              disabled={!ready || busy}
              onPick={(q) => void ask(q.question)}
            />
          )}
          <label className="sr-only" htmlFor="ai-question">
            AI에게 질문
          </label>
          <textarea
            id="ai-question"
            value={question}
            maxLength={MAX_QUESTION}
            placeholder="예: 이번 달 지점별 매출을 비교해줘"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className={`btn min-h-8 px-2.5 py-1 ${suggestionsOpen ? "border-primary text-primary" : ""}`}
                aria-expanded={suggestionsOpen}
                aria-controls="ai-suggestions"
                onClick={() => setSuggestionsOpen(!suggestionsOpen)}
              >
                <Icon name="ai" size={14} />
                추천 질문
                <Icon
                  name="chevron"
                  size={12}
                  className={suggestionsOpen ? "rotate-90" : "-rotate-90"}
                />
              </button>
              <span className="truncate text-[11px] text-muted">
                Enter로 보내기 · Shift+Enter로 줄바꿈
              </span>
            </div>
            {busy ? (
              <Button type="button" onClick={() => abort.current?.abort()}>
                질문 취소
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!question.trim() || !ready}
              >
                <Icon name="ai" size={16} />
                질문하기
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function Examples({
  domain,
  setDomain,
  examples,
  salesAllowed,
  disabled,
  onPick,
}: {
  domain: string;
  setDomain: (domain: string) => void;
  examples: PocQuestionSpec[];
  salesAllowed: boolean;
  disabled: boolean;
  onPick: (question: PocQuestionSpec) => void;
}) {
  return (
    <section aria-labelledby="ai-examples-title" className="py-2">
      <h3 id="ai-examples-title" className="mb-1">
        이런 질문을 할 수 있어요
      </h3>
      <p className="help mb-3">
        질문을 고르면 바로 조회해요. 직접 입력해도 돼요.
      </p>
      <div className="tabs" role="tablist" aria-label="질문 분야">
        {DOMAINS.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={domain === d}
            className={`tab ${domain === d ? "active" : ""}`}
            onClick={() => setDomain(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {examples.map((q) => {
          const blocked = q.requiresSalesRead && !salesAllowed;
          return (
            <li key={q.code}>
              <button
                type="button"
                className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled || blocked}
                onClick={() => onPick(q)}
              >
                <span className="block text-[11px] font-semibold text-primary">
                  {q.domain}
                </span>
                <span className="block text-[13px] text-ink">{q.question}</span>
                {blocked && (
                  <span className="mt-1 block text-[11px] text-muted">
                    매출 조회 권한이 있어야 볼 수 있어요.
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TurnView({
  turn,
  userName,
  scope,
  disabled,
  onView,
  onChoose,
}: {
  turn: Turn;
  userName: string;
  scope: string;
  disabled: boolean;
  onView: (view: string) => void;
  onChoose: (option: ClarificationOptionDto) => void;
}) {
  const time = new Date(turn.askedAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <>
      <article className="message" aria-label="내 질문">
        <Avatar name={userName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-xs">{userName}</b>
            <time className="text-[10px] text-muted" dateTime={turn.askedAt}>
              {time}
            </time>
          </div>
          <p>{turn.question}</p>
        </div>
      </article>
      <article className="message" aria-label="AI 답변">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-soft text-primary"
          aria-hidden="true"
        >
          <Icon name="ai" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="text-xs">업무 AI</b>
          {turn.state === "loading" && <Working />}
          {turn.state !== "loading" && turn.stages.length > 0 && (
            <Stages stages={turn.stages} elapsedMs={turn.elapsedMs} />
          )}
          {turn.state === "completed" && turn.parsed && (
            <Answer
              parsed={turn.parsed}
              message={turn.message}
              view={turn.view}
              scope={scope}
              onView={onView}
            />
          )}
          {turn.state === "clarification" && (
            <>
              <p>{turn.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {turn.options.map((option) => (
                  <Button
                    key={option.id}
                    disabled={disabled}
                    onClick={() => onChoose(option)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {(turn.state === "refused" || turn.state === "error") && (
            <p role={turn.state === "error" ? "alert" : undefined}>
              {turn.message}
            </p>
          )}
        </div>
      </article>
    </>
  );
}

function Answer({
  parsed,
  message,
  view,
  scope,
  onView,
}: {
  parsed: ParsedAiResult;
  message: string;
  view: string;
  scope: string;
  onView: (view: string) => void;
}) {
  const primary = toViewMode(parsed.primaryComponent);
  const views = [
    primary,
    ...(parsed.salesRows.length > 0 ? ["bar", "line"] : []),
    "table",
  ].filter((v, i, all) => all.indexOf(v) === i);
  const sales = parsed.salesRows;
  const total = (key: "approved" | "refunds" | "net") =>
    sales.reduce((sum, row) => sum + row[key], 0);
  const empty =
    sales.length === 0 && parsed.datasetList.every((d) => d.rows.length === 0);
  return (
    <>
      {message && <p>{message}</p>}
      <section
        className="card mt-2 max-w-3xl"
        aria-label={`${parsed.title} 결과`}
      >
        <header className="card-header">
          <h3 className="text-sm">{parsed.title}</h3>
          {views.length > 1 && (
            <div className="flex gap-1" role="group" aria-label="결과 보기">
              {views.map((v) => (
                <Button
                  key={v}
                  variant={view === v ? "primary" : ""}
                  aria-pressed={view === v}
                  onClick={() => onView(v)}
                >
                  {viewLabel(v)}
                </Button>
              ))}
            </div>
          )}
        </header>
        <div className="p-4">
          {empty ? (
            <State
              title="조회된 데이터가 없어요"
              message="기간과 허용 지점을 확인해 주세요."
            />
          ) : (
            <>
              {sales.length > 0 && (
                <dl className="mb-4 grid grid-cols-3 gap-2 text-xs">
                  {(
                    [
                      ["순매출", total("net")],
                      ["승인 결제액", total("approved")],
                      ["환불액", total("refunds")],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-soft p-3">
                      <dt className="text-muted">{label}</dt>
                      <dd className="m-0 mt-1 text-base font-semibold">
                        {won(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <ViewSpecRenderer
                parsed={parsed}
                activeView={view}
                scope={scope}
              />
            </>
          )}
        </div>
        <p className="help border-t border-line px-4 py-3">
          기준 시각{" "}
          {parsed.asOf ? parsed.asOf.slice(0, 16).replace("T", " ") : "-"}
          {" · "}Asia/Seoul
          {parsed.warnings.length > 0 && ` · ${parsed.warnings.join(" · ")}`}
        </p>
      </section>
    </>
  );
}

function viewLabel(view: string) {
  return (
    {
      table: "표",
      bar: "막대",
      line: "선",
      ranked_bar: "순위",
      heatmap: "히트맵",
      seat_map: "좌석",
      week_calendar: "캘린더",
      task_list: "목록",
      kpi: "요약",
    }[view] || view
  );
}

/**
 * Shown while the single /ai/queries request runs. The engine reports its stages only with the answer, so this shows
 * the elapsed time instead of claiming a stage it cannot know.
 */
function Working() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="flex items-center gap-2 text-muted" role="status">
      <span className="spinner !h-4 !w-4" aria-hidden="true" />
      AI 작업 중… 질문을 해석하고 권한 안에서 데이터를 조회하고 있어요
      {seconds > 0 && <span className="tabular-nums"> · {seconds}초</span>}
    </p>
  );
}

/** The engine's stage record of one answer (접수 → 검색 → 조회 명세 → 검증 → 조회 → 결과 검증). */
function Stages({
  stages,
  elapsedMs,
}: {
  stages: StageSpanDto[];
  elapsedMs: number;
}) {
  return (
    <details className="mt-1 text-[11px] text-muted">
      <summary className="cursor-pointer select-none">
        처리 과정 {stages.length}단계 · {(elapsedMs / 1000).toFixed(1)}초
      </summary>
      <ol className="mt-1 grid gap-0.5 pl-4">
        {stages.map((stage, i) => (
          <li key={`${stage.stage}-${i}`} className="list-decimal">
            {stage.label}
            {stage.status !== "COMPLETED" && ` (${stage.status})`}
            <span className="tabular-nums"> · {stage.durationMs}ms</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Suggested questions opened from the composer's toggle, above the text box. Picking one adds a turn to the same
 * conversation and closes the panel.
 */
function Suggestions({
  salesAllowed,
  disabled,
  onPick,
}: {
  salesAllowed: boolean;
  disabled: boolean;
  onPick: (question: PocQuestionSpec) => void;
}) {
  return (
    <ul
      id="ai-suggestions"
      aria-label="추천 질문"
      className="mb-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto border-b border-line pb-3"
    >
      {POC_QUESTIONS.map((q) => {
        const blocked = q.requiresSalesRead && !salesAllowed;
        return (
          <li key={q.code}>
            <button
              type="button"
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled || blocked}
              title={
                blocked ? "매출 조회 권한이 있어야 볼 수 있어요." : q.question
              }
              onClick={() => onPick(q)}
            >
              {q.shortLabel}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function emptyTurn(question: string, askedAt: string): Turn {
  return {
    id: crypto.randomUUID(),
    question,
    askedAt,
    state: "loading",
    parsed: null,
    view: "",
    message: "",
    options: [],
    stages: [],
    elapsedMs: 0,
  };
}

/** What a turn shows for one engine response, asked now or reopened. */
function outcome(res: AiQueryResponseDto): Partial<Turn> {
  const stages = res.stages ?? [];
  if (res.status === "COMPLETED" && res.envelope) {
    const parsed = parseAiResult(res);
    return {
      stages,
      state: "completed",
      parsed,
      view: toViewMode(parsed.primaryComponent),
      message: res.message || "",
    };
  }
  if (res.status === "CLARIFICATION")
    return {
      stages,
      state: "clarification",
      message:
        res.message ||
        "어떤 지표를 볼지 확인이 필요해요. 아래에서 하나를 골라 주세요.",
      options: res.clarificationOptions || [],
    };
  return {
    stages,
    state: "refused",
    message:
      res.message || "이 질문은 지금 권한이나 조회 범위에서 답할 수 없어요.",
  };
}

/** The employee's saved AI conversations (#71): open, rename and delete. */
function History({
  conversations,
  loading,
  error,
  retry,
  activeId,
  disabled,
  onNew,
  onOpen,
  onRename,
  onRemove,
}: {
  conversations?: AiConversationSummary[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
  activeId?: string;
  disabled: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState("");
  async function run(action: () => Promise<void>) {
    setFailure("");
    try {
      await action();
    } catch (e) {
      setFailure((e as Error).message || "처리하지 못했어요.");
    }
  }
  return (
    <aside className="chat-list" aria-labelledby="ai-history-title">
      <header className="chat-header">
        <h2 id="ai-history-title">대화 기록</h2>
        <Button variant="primary" disabled={disabled} onClick={onNew}>
          <Icon name="plus" size={14} />새 대화
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {failure && (
          <div className="mb-2">
            <FieldError>{failure}</FieldError>
          </div>
        )}
        {loading ? (
          <State loading />
        ) : error ? (
          <ErrorState error={error} retry={retry} />
        ) : !conversations?.length ? (
          <p className="help px-2 py-4">
            아직 저장된 대화가 없어요. 질문하면 여기에 남아요.
          </p>
        ) : (
          <ul className="grid gap-1">
            {conversations.map((c) => {
              const title = c.title || "제목 없는 대화";
              if (editing === c.id)
                return (
                  <li key={c.id}>
                    <form
                      className="grid gap-2 rounded-lg border border-line p-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const next = draft.trim();
                        if (!next) return;
                        void run(async () => {
                          await onRename(c.id, next);
                          setEditing(undefined);
                        });
                      }}
                    >
                      <label className="sr-only" htmlFor={`ai-title-${c.id}`}>
                        대화 제목
                      </label>
                      <input
                        id={`ai-title-${c.id}`}
                        value={draft}
                        maxLength={200}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(undefined);
                        }}
                      />
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          onClick={() => setEditing(undefined)}
                        >
                          취소
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={!draft.trim()}
                        >
                          저장
                        </Button>
                      </div>
                    </form>
                  </li>
                );
              return (
                <li
                  key={c.id}
                  className={`rounded-lg px-3 py-2 ${c.id === activeId ? "bg-soft" : "hover:bg-soft"}`}
                >
                  <button
                    type="button"
                    className={`block w-full truncate text-left text-[13px] disabled:cursor-not-allowed ${c.id === activeId ? "font-semibold text-primary" : "text-ink"}`}
                    aria-current={c.id === activeId ? "true" : undefined}
                    disabled={disabled}
                    onClick={() => onOpen(c.id)}
                  >
                    {title}
                  </button>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <time dateTime={c.lastAskedAt}>
                      {displayDate(c.lastAskedAt)}
                    </time>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="hover:text-primary disabled:opacity-50"
                        aria-label={`${title} 제목 변경`}
                        disabled={disabled}
                        onClick={() => {
                          setDraft(c.title || "");
                          setEditing(c.id);
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="hover:text-primary disabled:opacity-50"
                        aria-label={`${title} 삭제`}
                        disabled={disabled}
                        onClick={() => {
                          if (
                            window.confirm(
                              `'${title}' 대화를 삭제할까요? 삭제한 대화는 되돌릴 수 없어요.`,
                            )
                          )
                            void run(() => onRemove(c.id));
                        }}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
