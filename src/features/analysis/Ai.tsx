import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, MOCK } from "../../shared/api/client";
import { formatDateTime } from "../../shared/domain/format";
import { can, displayDate } from "../../shared/domain/schema";
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
import { AiChartResults, AiCsvExports } from "./AiExports";
import { aiReuse } from "./ai-reuse-api";
import type {
  AiConditions,
  AiContext,
  AiEditableFilters,
  AiRecentQuery,
  AiRefinement,
} from "./ai-reuse-api";
import {
  analysisName,
  AppliedConditions,
  ContextSummary,
  reuseFailure,
} from "./AiConditions";
import { ResultDetails } from "./ResultDetails";
import {
  aiConversations,
  executeAiQuery,
  parseAiResult,
  normalizeComponentType,
  POC_QUESTIONS,
  toViewMode,
} from "./domainlens";
import type {
  AiConversationSummary,
  AiQueryRequest,
  AiReadiness,
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
  retry?: AiQueryRequest;
  executionId?: string | null;
  conditions?: AiConditions | null;
  editableFilters?: AiEditableFilters | null;
  context?: AiContext | null;
  refined?: boolean;
  recentResult?: boolean;
}

const DOMAINS = ["전체", "매출", "좌석", "이용권", "스터디룸", "업무", "근태"];
const MAX_QUESTION = 500;
const QUERY_TIMEOUT_MS = 60_000;

/**
 * The AI chat (DomainLens natural-language reads). A refused answer explains itself; it never shows partial data.
 * A scope or account change starts a new conversation (the key), since earlier answers were read under other
 * permissions.
 */
export function Ai() {
  const { session, scope } = useApp();
  const { user } = session;
  const access = session.branches.map(({ id }) => [
    id,
    can(user, id, "ai:read"),
    can(user, id, "sales:read"),
  ]);
  return <AiChat key={JSON.stringify([user.id, scope, access])} />;
}

function AiChat() {
  const { session, scope } = useApp();
  const user = session.user;
  const allowed = can(user, scope, "ai:read");
  const salesAllowed = can(user, scope, "sales:read");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [domain, setDomain] = useState("전체");
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Phones show either the history or the conversation (the team chat's list/main switch).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"conversations" | "recent">(
    "conversations",
  );
  const [reuseBusy, setReuseBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const historyKey = ["data", user.id, scope, "ai", "conversations"];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => clearOnDenial(() => aiConversations.list(signal)),
    enabled: allowed,
    retry: false,
  });
  const recentKey = ["data", user.id, scope, "ai", "recent"];
  const recent = useQuery({
    queryKey: recentKey,
    queryFn: ({ signal }) => aiReuse.recent(signal),
    enabled: allowed && historyTab === "recent",
    retry: false,
  });
  const readiness = useQuery({
    queryKey: ["data", user.id, scope, "ai", "readiness"],
    queryFn: ({ signal }) =>
      clearOnDenial(() =>
        api<AiReadiness>("/ai/catalog/readiness", { signal }),
      ),
    enabled: allowed,
    retry: false,
  });
  useEffect(() => {
    function expire() {
      abort.current?.abort();
      setTurns([]);
      setQuestion("");
      setConversationId(undefined);
    }
    window.addEventListener("openstudy:session-expired", expire);
    return () => {
      window.removeEventListener("openstudy:session-expired", expire);
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  function patch(id: string, next: Partial<Turn>) {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...next } : t)));
  }

  async function checkReadiness() {
    const result = await readiness.refetch();
    if (result.isSuccess) setNotReady(!result.data.ready);
  }

  function refreshHistory() {
    void client.invalidateQueries({ queryKey: historyKey });
    void client.invalidateQueries({ queryKey: recentKey });
  }

  async function ask(
    text: string,
    clarificationChoice?: string,
    retry?: AiQueryRequest,
    newConversation = false,
  ) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_QUESTION || abort.current || !ready)
      return;
    const startFresh =
      newConversation || turns.some((turn) => turn.recentResult);
    const payload = retry ?? {
      question: trimmed,
      scope,
      clarificationChoice,
      conversationId: startFresh ? undefined : conversationId,
      clientRequestKey: crypto.randomUUID(),
    };
    const turn = emptyTurn(trimmed, new Date().toISOString());
    const id = turn.id;
    if (startFresh) setConversationId(undefined);
    setTurns((all) => [
      ...(startFresh ? [] : all.map((t) => ({ ...t, retry: undefined }))),
      turn,
    ]);
    setHistoryOpen(false);
    setReopenError("");
    setQuestion("");
    setSuggestionsOpen(false);
    setBusy(true);
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    abort.current = controller;
    try {
      const res = await executeAiQuery(payload, signal);
      signal.throwIfAborted();
      if (res.conversationId) setConversationId(res.conversationId);
      if (res.status === "NOT_READY") {
        setNotReady(true);
        void checkReadiness();
      }
      if (res.httpStatus === 403 && isAccessFailure(res.errorCode)) {
        setTurns([turn]);
      }
      patch(id, {
        ...outcome(res),
        retry:
          res.status === "NOT_READY" || res.status === "RATE_LIMITED"
            ? payload
            : undefined,
      });
      refreshHistory();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setTurns(e.status === 403 ? [turn] : []);
      }
      patch(id, {
        state: "error",
        retry:
          signal.aborted ||
          (e instanceof ApiError &&
            (e.status === 0 || e.status === 429 || e.status >= 500))
            ? payload
            : undefined,
        message: controller.signal.aborted
          ? "질문 대기를 취소했어요."
          : timeout.aborted
            ? "응답 제한 시간을 넘겼어요. 다시 시도해 주세요."
            : failureMessage(
                e instanceof ApiError ? e.detail.code : undefined,
                e instanceof ApiError ? e.status : undefined,
                (e as Error).message,
              ),
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
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setReopening(true);
    setReopenError("");
    setHistoryOpen(false);
    setTurns([]);
    setConversationId(id);
    try {
      const saved = await aiConversations.reopen(id, scope, controller.signal);
      controller.signal.throwIfAborted();
      setTurns(
        saved.turns.map((t) => ({
          ...emptyTurn(t.question, t.askedAt),
          ...outcome(t.response),
          context: null,
          refined: t.origin === "REFINEMENT",
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

  async function refine(source: Turn, body: AiRefinement) {
    if (!source.executionId || abort.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(QUERY_TIMEOUT_MS),
    ]);
    abort.current = controller;
    setReuseBusy(true);
    try {
      const response = await aiReuse.refine(source.executionId, body, signal);
      signal.throwIfAborted();
      if (response.status !== "COMPLETED" || !response.envelope) {
        throw new Error(
          response.message || "조건을 변경하지 못했어요. 다시 질문해 주세요.",
        );
      }
      const turn = {
        ...emptyTurn(source.question, new Date().toISOString()),
        ...outcome(response),
        refined: true,
      };
      if (response.conversationId) setConversationId(response.conversationId);
      setTurns((all) => [
        ...all.map((item) => ({ ...item, recentResult: false })),
        turn,
      ]);
      refreshHistory();
    } finally {
      if (abort.current === controller) abort.current = null;
      setReuseBusy(false);
    }
  }

  async function runRecent(item: AiRecentQuery) {
    if (abort.current) return;
    if (!item.rerunnable) {
      await ask(item.question, undefined, undefined, true);
      return;
    }
    if (!item.executionId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(QUERY_TIMEOUT_MS),
    ]);
    abort.current = controller;
    setReuseBusy(true);
    setHistoryOpen(false);
    setConversationId(undefined);
    setReopenError("");
    setTurns([]);
    try {
      const execution = await aiReuse.execution(
        item.executionId,
        undefined,
        signal,
      );
      signal.throwIfAborted();
      const parsed = parseAiResult(execution);
      setTurns([
        {
          ...emptyTurn(item.question, item.askedAt),
          executionId: execution.id,
          conditions: execution.conditions,
          editableFilters: execution.editableFilters,
          refined: execution.origin === "REFINEMENT",
          recentResult: true,
          state: "completed",
          parsed,
          view: toViewMode(parsed.primaryComponent),
          message: "최근 질문의 결과를 다시 조회했어요.",
        },
      ]);
    } catch (error) {
      if (!controller.signal.aborted) setReopenError(reuseFailure(error));
    } finally {
      if (abort.current === controller) abort.current = null;
      setReuseBusy(false);
    }
  }

  async function rename(id: string, title: string) {
    await clearOnDenial(() => aiConversations.rename(id, title));
    refreshHistory();
  }

  async function remove(id: string) {
    await clearOnDenial(() => aiConversations.remove(id));
    if (id === conversationId) startNew();
    refreshHistory();
  }

  async function clearOnDenial<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        startNew();
      throw e;
    }
  }

  if (!allowed)
    return (
      <State
        title="AI 조회 권한이 필요해요"
        message="관리자에게 현재 지점의 AI 조회 권한을 확인해 주세요."
      />
    );
  const historyAccessDenied =
    history.error instanceof ApiError &&
    [401, 403].includes(history.error.status);
  const readinessAccessDenied =
    readiness.error instanceof ApiError &&
    [401, 403].includes(readiness.error.status);
  const ready = Boolean(
    readiness.data?.ready &&
    !readiness.error &&
    !notReady &&
    !historyAccessDenied,
  );
  const pending = busy || reopening || reuseBusy;
  const examples = POC_QUESTIONS.filter(
    (q) => domain === "전체" || q.domain === domain,
  );
  return (
    // has-channel shows the conversation on phones; without it the history list is shown (as in the team chat).
    <div className={`chat-shell ${historyOpen ? "" : "has-channel"}`}>
      <History
        conversations={
          historyAccessDenied || readinessAccessDenied
            ? undefined
            : history.data
        }
        loading={history.isPending}
        error={history.error}
        retry={() => void history.refetch()}
        activeId={conversationId}
        disabled={pending}
        tab={historyTab}
        onTab={setHistoryTab}
        recent={
          historyAccessDenied || readinessAccessDenied || recent.error
            ? undefined
            : recent.data?.items
        }
        recentLoading={recent.isPending}
        recentError={recent.error}
        retryRecent={() => void recent.refetch()}
        onRunRecent={(item) => void runRecent(item)}
        canAsk={ready}
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
              대화 기록 · 최근 질문
            </Button>
          </div>
        </header>
        <div className="messages" aria-live="polite">
          {readiness.error ? (
            <ErrorState
              error={readiness.error}
              retry={() => void checkReadiness()}
            />
          ) : notReady || readiness.data?.ready === false ? (
            <div className="tip mb-4 flex flex-wrap items-center gap-3">
              AI 엔진이 아직 준비되지 않았어요.
              {readiness.data?.reasons?.length ? (
                <ul>
                  {readiness.data.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <Button onClick={() => void checkReadiness()}>다시 확인</Button>
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
          {historyAccessDenied || readinessAccessDenied ? null : reopening ? (
            <State
              loading
              title="대화를 다시 여는 중이에요"
              message="저장된 질문을 지금 권한과 기준 시각으로 다시 조회하고 있어요."
            />
          ) : reuseBusy && turns.length === 0 ? (
            <State loading title="최근 질문의 결과를 다시 조회하고 있어요" />
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
              disabled={!ready || pending}
              onPick={(q) => void ask(q.question)}
            />
          ) : (
            turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                userName={user.name}
                scope={scope}
                disabled={pending || !ready}
                onRefine={(body) => refine(turn, body)}
                onRetry={() => void ask(turn.question, undefined, turn.retry)}
                onView={(view) => patch(turn.id, { view })}
                onChoose={(option) => void ask(turn.question, option.id)}
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
              disabled={!ready || pending}
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
                질문 대기 취소
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!question.trim() || !ready || pending}
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
  onRetry,
  onRefine,
}: {
  turn: Turn;
  userName: string;
  scope: string;
  disabled: boolean;
  onView: (view: string) => void;
  onChoose: (option: ClarificationOptionDto) => void;
  onRetry: () => void;
  onRefine: (body: AiRefinement) => Promise<void>;
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
          <p>{turn.refined ? "조건 변경" : turn.question}</p>
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
            <Stages stages={turn.stages} />
          )}
          {turn.state === "completed" && turn.parsed && (
            <Answer
              turn={turn}
              parsed={turn.parsed}
              disabled={disabled}
              onRefine={onRefine}
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
          {turn.retry && (
            <Button disabled={disabled} onClick={onRetry}>
              같은 질문 다시 시도
            </Button>
          )}
        </div>
      </article>
    </>
  );
}

function Answer({
  turn,
  parsed,
  scope,
  disabled,
  onRefine,
  onView,
}: {
  turn: Turn;
  parsed: ParsedAiResult;
  scope: string;
  disabled: boolean;
  onRefine: (body: AiRefinement) => Promise<void>;
  onView: (view: string) => void;
}) {
  const { view, message, executionId } = turn;
  const [accessDenied, setAccessDenied] = useState(false);
  const [refinementDenied, setRefinementDenied] = useState(false);
  const [detailDatasetId, setDetailDatasetId] = useState<string>();
  const showDetails =
    view === "table" && executionId && parsed.datasetList.length > 0;
  function selectView(next: string) {
    if (next === "table") {
      setRefinementDenied(false);
      if (view !== "table") {
        const component = parsed.viewSpec?.components.find((item) => {
          const type = normalizeComponentType(item.componentRef.id);
          return type && toViewMode(type) === view;
        });
        setDetailDatasetId(component?.datasetId ?? undefined);
      }
    }
    onView(next);
  }

  async function apply(body: AiRefinement) {
    try {
      await onRefine(body);
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        setAccessDenied(true);
        setRefinementDenied(true);
      }
      throw error;
    }
  }
  const views = [
    ...new Set([...parsed.componentTypes.map(toViewMode), "table"]),
  ];
  const empty = parsed.datasetList.every((d) => d.rows.length === 0);
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
                  onClick={() => selectView(v)}
                >
                  {viewLabel(v)}
                </Button>
              ))}
            </div>
          )}
        </header>
        <AiCsvExports
          key={executionId}
          executionId={executionId}
          parsed={parsed}
          accessDenied={accessDenied}
        />
        {(turn.conditions || turn.context) && (
          <div className="grid gap-2 border-b border-line px-4 py-3">
            {turn.conditions && (
              <AppliedConditions
                conditions={turn.conditions}
                editable={turn.editableFilters}
                disabled={disabled}
                onRefine={executionId ? apply : undefined}
              />
            )}
            <ContextSummary context={turn.context} />
          </div>
        )}
        <div className="p-4">
          {showDetails && !refinementDenied ? (
            <ResultDetails
              executionId={executionId}
              original={parsed}
              initialDatasetId={detailDatasetId}
              onAccessChecked={setAccessDenied}
            />
          ) : accessDenied ? (
            <>
              <State
                title="현재 조건으로 결과를 볼 수 없어요"
                message="조회 범위를 줄여 조건을 변경하거나 다시 질문해 주세요."
              />
              {showDetails && (
                <Button
                  type="button"
                  onClick={() => setRefinementDenied(false)}
                >
                  표 다시 조회
                </Button>
              )}
            </>
          ) : empty ? (
            <State
              title="결과 없음"
              message="기간과 허용 지점을 확인해 주세요."
            />
          ) : (
            <>
              <AiChartResults
                parsed={parsed}
                activeView={view}
                scope={scope}
                conditions={turn.conditions}
              />
            </>
          )}
        </div>
        {!accessDenied && parsed.truncation?.isTruncated && (
          <p className="tip mx-4 mb-3">
            {parsed.truncation.message ||
              `일부 결과만 표시해요. 최대 ${parsed.truncation.maxRows}행까지 조회했어요.`}
          </p>
        )}
        {!accessDenied && !showDetails && (
          <p className="help border-t border-line px-4 py-3">
            기준 시각 {formatDateTime(parsed.asOf)}
            {" · "}Asia/Seoul
            {" · "}선택 범위 {scope === "all" ? "허용된 지점" : scope}
            {parsed.notice && ` · ${parsed.notice}`}
            {parsed.warnings.length > 0 && ` · ${parsed.warnings.join(" · ")}`}
          </p>
        )}
      </section>
    </>
  );
}

function viewLabel(view: string) {
  return (
    {
      table: "표로 보기",
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
function Stages({ stages }: { stages: StageSpanDto[] }) {
  const elapsedMs = stages.reduce(
    (total, stage) => total + (stage.durationMs ?? 0),
    0,
  );
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
      executionId: res.executionId,
      conditions: res.conditions,
      context: res.context,
      editableFilters: res.editableFilters,
      view: toViewMode(parsed.primaryComponent),
      message: res.message || "",
    };
  }
  if (res.status === "CLARIFICATION")
    return {
      stages,
      state: "clarification",
      message:
        res.errorCode === "BRANCH_REQUIRED"
          ? "조회할 지점을 골라 주세요."
          : res.message ||
            "어떤 지표를 볼지 확인이 필요해요. 아래에서 하나를 골라 주세요.",
      options: res.clarificationOptions || [],
    };
  return {
    stages,
    state: "refused",
    message:
      res.status === "REFUSED" && res.errorCode
        ? reuseFailure(
            new ApiError(res.httpStatus, {
              code: res.errorCode,
              message: failureMessage(
                res.errorCode,
                res.httpStatus,
                res.message,
              ),
            }),
          )
        : failureMessage(res.errorCode, res.httpStatus, res.message),
  };
}

const ACCESS_FAILURES = new Set([
  "AI_PERMISSION_DENIED",
  "BRANCH_SCOPE_DENIED",
  "SALES_PERMISSION_DENIED",
  "AUTHORIZATION_SCOPE_CHECK",
]);

function isAccessFailure(code?: string | null) {
  return !code || code === "FORBIDDEN" || ACCESS_FAILURES.has(code);
}

function failureMessage(
  code?: string | null,
  status?: number,
  fallback?: string | null,
) {
  if (status === 429)
    return "질문 요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
  switch (code) {
    case "QUESTION_EMPTY":
    case "QUESTION_LENGTH_EXCEEDED":
      return "질문을 1~500자로 입력해 주세요.";
    case "VALIDATION_FAILED":
      return "조회 지점이나 선택한 조건을 확인해 주세요.";
    case "DATE_RANGE_LIMIT_EXCEEDED":
      return "조회 기간을 366일 이내로 줄여 주세요.";
    case "REJECT_ARBITRARY_HTML":
    case "REJECT_RAW_SQL":
    case "UNSUPPORTED_MODIFICATION_INTENT":
      return "코드 실행이나 변경 요청은 처리할 수 없어요. 조회할 내용을 질문해 주세요.";
    case "PII_OR_SCOPE_DENIED":
    case "PII_MINIMIZATION":
    case "CREDENTIAL_ACCESS_DENIED":
    case "FORBIDDEN_SOURCE_DENIED":
      return "개인정보, 인증 정보 또는 제한된 원천은 조회할 수 없어요.";
    case "AI_PERMISSION_DENIED":
    case "BRANCH_SCOPE_DENIED":
    case "SALES_PERMISSION_DENIED":
    case "AUTHORIZATION_SCOPE_CHECK":
    case "FORBIDDEN":
      return "현재 권한과 지점 범위로는 이 질문을 조회할 수 없어요.";
    case "AI_NOT_READY":
      return "AI 엔진이 준비되지 않아 질문을 실행하지 못했어요.";
    case "ANALYSIS_UNAVAILABLE":
      return "저장된 질문의 분석은 현재 제공되지 않아요.";
    case "REOPEN_NOT_EXECUTABLE":
      return "저장된 질문을 지금 다시 실행할 수 없어요.";
    case "OUT_OF_DOMAIN":
      return "지원하는 업무 지표로 질문해 주세요.";
    default:
      return fallback || "AI 조회를 완료하지 못했어요.";
  }
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
  tab,
  onTab,
  recent,
  recentLoading,
  recentError,
  retryRecent,
  onRunRecent,
  canAsk,
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
  tab: "conversations" | "recent";
  onTab: (tab: "conversations" | "recent") => void;
  recent?: AiRecentQuery[];
  recentLoading: boolean;
  recentError: Error | null;
  retryRecent: () => void;
  onRunRecent: (item: AiRecentQuery) => void;
  canAsk: boolean;
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
        <h2 id="ai-history-title" className="sr-only">
          질문 기록
        </h2>
        <div className="tabs" role="group" aria-label="질문 기록 보기">
          <button
            type="button"
            className={`tab ${tab === "conversations" ? "active" : ""}`}
            aria-pressed={tab === "conversations"}
            onClick={() => onTab("conversations")}
          >
            대화 기록
          </button>
          <button
            type="button"
            className={`tab ${tab === "recent" ? "active" : ""}`}
            aria-pressed={tab === "recent"}
            onClick={() => onTab("recent")}
          >
            최근 질문
          </button>
        </div>
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
        {tab === "recent" ? (
          <RecentQuestions
            items={recent}
            loading={recentLoading}
            error={recentError}
            retry={retryRecent}
            disabled={disabled}
            canAsk={canAsk}
            onRun={onRunRecent}
          />
        ) : loading ? (
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

function RecentQuestions({
  items,
  loading,
  error,
  retry,
  disabled,
  canAsk,
  onRun,
}: {
  items?: AiRecentQuery[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
  disabled: boolean;
  canAsk: boolean;
  onRun: (item: AiRecentQuery) => void;
}) {
  if (loading) return <State loading />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (!items?.length)
    return <p className="help px-2 py-4">최근 30일 동안 한 질문이 없어요.</p>;
  const statusLabels: Record<string, string> = {
    READY: "조회 완료",
    COMPLETED: "조회 완료",
    CLARIFICATION: "확인 필요",
    UNSUPPORTED: "지원하지 않음",
    REFUSED: "거절",
    DENIED: "권한 거절",
    CANCELED: "취소",
    INVALID: "입력 오류",
  };
  return (
    <ul className="grid gap-2" aria-label="최근 질문 목록">
      {items.map((item) => (
        <li
          key={item.requestId}
          className="grid gap-1 rounded-lg border border-line p-2"
        >
          <p className="break-words text-sm font-semibold">{item.question}</p>
          <p className="help">
            {item.conversationTitle || "제목 없는 대화"} ·{" "}
            {statusLabels[item.status] ?? item.status}
          </p>
          <p className="help">
            {item.analysisId ? `${analysisName(item.analysisId)} · ` : ""}
            <time dateTime={item.askedAt}>{formatDateTime(item.askedAt)}</time>
          </p>
          <div>
            <Button
              type="button"
              disabled={
                disabled || (item.rerunnable ? !item.executionId : !canAsk)
              }
              onClick={() => onRun(item)}
            >
              {item.rerunnable ? "결과 다시 조회" : "새 질문으로 보내기"}
            </Button>
            {!item.rerunnable && (
              <p className="help">AI가 이 질문을 새로 해석해요.</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
