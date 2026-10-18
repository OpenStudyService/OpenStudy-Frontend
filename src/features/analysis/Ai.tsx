import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE, MOCK } from "../../shared/api/client";
import { openStream } from "../../shared/api/stream";
import { can } from "../../shared/domain/schema";
import { useApp } from "../../app/context";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { SalesChart, SalesTable } from "./Charts";
import { getExecution } from "./domainlens";
import type { Execution } from "./domainlens";
const labels: Record<string, string> = {
  idle: "질문을 입력해 주세요",
  accepted: "질문 접수",
  retrieving: "업무 지표 확인",
  generating: "조회 명세 생성",
  validating: "권한·조건 검증",
  executing: "데이터 조회",
  completed: "조회 완료",
  failed: "조회 실패",
  canceled: "취소됨",
  clarification: "확인이 필요해요",
  unsupported: "지원하지 않는 질문",
};
export function Ai() {
  const { session, scope } = useApp(),
    [question, setQuestion] = useState(""),
    [requestId, setRequestId] = useState(""),
    [phase, setPhase] = useState("idle"),
    [error, setError] = useState(""),
    [result, setResult] = useState<Execution | null>(null),
    [choices, setChoices] = useState<{ id: string; label: string }[]>([]),
    [view, setView] = useState("bar"),
    [submitting, setSubmitting] = useState(false);
  const allowed =
    can(session.user, scope, "ai:read") &&
    can(session.user, scope, "sales:read");
  const readiness = useQuery({
    queryKey: ["data", session.user.id, scope, "ai", "readiness"],
    queryFn: ({ signal }) =>
      api<{ ready: boolean; mode?: string; message?: string }>(
        "/catalog/readiness",
        { signal },
      ),
    enabled: allowed,
    retry: false,
  });
  const active = [
    "accepted",
    "retrieving",
    "generating",
    "validating",
    "executing",
  ].includes(phase);
  useEffect(() => {
    if (!requestId) return;
    let terminal = false;
    const listeners: Record<string, (event: MessageEvent) => void> = {};
    for (const event of [
      "accepted",
      "retrieving",
      "generating",
      "validating",
      "executing",
    ])
      listeners[event] = () => setPhase(event);
    listeners.completed = (event) => {
      terminal = true;
      stop();
      const data = JSON.parse((event as MessageEvent).data) as {
        status: string;
        executionId?: string;
        unsupportedReason?: string;
      };
      if (data.status === "UNSUPPORTED") {
        setPhase("unsupported");
        setError(data.unsupportedReason || "지원하지 않는 질문입니다.");
      } else if (data.executionId)
        void getExecution(data.executionId)
          .then((r) => {
            setResult(r);
            setView(r.viewSpec.component);
            setPhase("completed");
          })
          .catch((e) => {
            setError(e.message);
            setPhase("failed");
          });
    };
    listeners.clarification = (event) => {
      terminal = true;
      stop();
      const data = JSON.parse((event as MessageEvent).data) as {
        clarificationOptions: { id: string; label: string }[];
      };
      setChoices(data.clarificationOptions || []);
      setPhase("clarification");
    };
    listeners.failed = (event) => {
      terminal = true;
      stop();
      const data = JSON.parse((event as MessageEvent).data) as {
        message: string;
      };
      setError(data.message);
      setPhase("failed");
    };
    listeners.canceled = () => {
      terminal = true;
      stop();
      setPhase("canceled");
    };
    const stop = openStream(
      `${API_BASE}/requests/${requestId}/events`,
      listeners,
      (connected) => {
        if (connected) setError("");
        else if (!terminal)
          setError(
            "연결이 끊겨 재연결 중입니다. 같은 요청을 이어서 확인하고 있어요.",
          );
      },
    );
    const timeout = setTimeout(() => {
      if (!terminal) {
        terminal = true;
        stop();
        void api(`/requests/${requestId}/cancel`, {
          method: "POST",
          body: {},
        }).catch(() => undefined);
        setError("조회 제한 시간 60초를 초과했습니다. 다시 시도해 주세요.");
        setPhase("failed");
      }
    }, 60000);
    return () => {
      clearTimeout(timeout);
      stop();
      if (!terminal)
        void api(`/requests/${requestId}/cancel`, {
          method: "POST",
          body: {},
        }).catch(() => undefined);
    };
  }, [requestId]);
  async function ask(text = question) {
    if (!text.trim() || active || submitting) return;
    setSubmitting(true);
    setQuestion(text);
    setError("");
    setResult(null);
    setChoices([]);
    try {
      const conversation = await api<{ id: string }>("/conversations", {
        method: "POST",
        body: {},
      });
      const request = await api<{ requestId: string }>(
        `/conversations/${conversation.id}/requests`,
        {
          method: "POST",
          body: { question: text, scope },
          key: crypto.randomUUID(),
        },
      );
      setPhase("accepted");
      setRequestId(request.requestId);
    } catch (e) {
      setPhase("failed");
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  if (!allowed)
    return (
      <State
        title="AI·매출 조회 권한이 필요해요"
        message="관리자에게 현재 지점의 권한을 확인해 주세요."
      />
    );
  return (
    <div className="page">
      <Heading
        title="업무 AI"
        description="우리 공간의 데이터를, 필요한 순간에 자연스럽게 물어보세요."
      >
        <Badge>{MOCK ? "AI 응답 모킹" : "DomainLens"}</Badge>
      </Heading>
      <div className="hero">
        <div className="relative z-10">
          <Icon name="ai" size={30} />
          <h2>
            궁금한 운영 현황,
            <br />
            질문에서 시작해 보세요.
          </h2>
          <p className="text-xs">
            허용된 지점과 지표 안에서 데이터를 조회하고 표와 차트로 정리해요.
          </p>
        </div>
      </div>
      {readiness.error ? (
        <ErrorState
          error={readiness.error}
          retry={() => void readiness.refetch()}
        />
      ) : readiness.data && !readiness.data.ready ? (
        <div className="tip mb-5">
          AI 엔진이 아직 준비되지 않았습니다. 준비 상태를 다시 확인해 주세요.
          <Button className="ml-3" onClick={() => void readiness.refetch()}>
            다시 확인
          </Button>
        </div>
      ) : null}
      {MOCK && (
        <p className="tip mb-5">
          가상 원장에서 일반 매출과 같은 기준으로 계산한 모킹 응답입니다. 실제
          DomainLens 엔진과 DB는 연결되지 않았습니다.
        </p>
      )}
      <form
        className="card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="ai-question" className="mb-3 block">
          어떤 데이터가 궁금하신가요?
        </label>
        <textarea
          id="ai-question"
          className="min-h-24 w-full"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1000}
          placeholder="지난달 지점별 매출을 보여줘"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn quiet"
            onClick={() => setQuestion("지난달 지점별 매출을 보여줘")}
          >
            지난달 지점별 매출 ↗
          </button>
          <div className="flex gap-2">
            {active && (
              <Button
                type="button"
                onClick={() =>
                  void api(`/requests/${requestId}/cancel`, {
                    method: "POST",
                    body: {},
                  }).catch((e) => setError(e.message))
                }
              >
                조회 취소
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={
                active ||
                submitting ||
                !question.trim() ||
                !readiness.data?.ready
              }
            >
              <Icon name="ai" size={16} />
              {active ? "조회 중…" : "질문하기"}
            </Button>
          </div>
        </div>
      </form>
      <section className="mt-5" aria-live="polite" aria-atomic="false">
        <div className="mb-4 flex items-center gap-2 text-xs">
          <Badge>{labels[phase]}</Badge>
          {active && (
            <span className="text-muted">
              현재 권한으로 데이터를 확인하고 있어요.
            </span>
          )}
        </div>
        {error && (
          <div className="mb-4">
            <FieldError>{error}</FieldError>
          </div>
        )}
        {phase === "clarification" && (
          <div className="card p-5">
            <h2>조회할 지표를 확인해 주세요.</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {choices.map((c) => (
                <Button key={c.id} onClick={() => void ask(c.label)}>
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        {result && (
          <section className="card">
            <header className="card-header">
              <h2>{result.viewSpec.title}</h2>
              <div className="flex gap-1">
                {[
                  ["table", "표"],
                  ["bar", "막대"],
                  ["line", "선"],
                ].map(([v, l]) => (
                  <Button
                    key={v}
                    variant={view === v ? "primary" : ""}
                    onClick={() => setView(v)}
                  >
                    {l}
                  </Button>
                ))}
              </div>
            </header>
            {!["table", "bar", "line"].includes(view) ? (
              <State
                title="지원하지 않는 결과 화면입니다"
                message="허용된 표 또는 차트 형식으로만 결과를 표시합니다."
              />
            ) : !result.rows.length ? (
              <State
                title="조회된 데이터가 없어요"
                message="기간과 허용 지점의 거래를 확인해 주세요."
              />
            ) : (
              <>
                {view !== "table" && (
                  <div className="p-5">
                    <SalesChart
                      rows={result.rows}
                      kind={view as "bar" | "line"}
                    />
                  </div>
                )}
                <SalesTable rows={result.rows} />
              </>
            )}
            <p className="help border-t border-line p-5">
              {result.start} 이상 ~ {result.end} 미만 · {result.timeZone} ·{" "}
              {result.currency} ·{" "}
              {result.refundBasis === "processed"
                ? "환불 처리일 기준"
                : "원결제일 차감 기준"}{" "}
              · 기준 시각 {result.asOf}
            </p>
          </section>
        )}
      </section>
    </div>
  );
}
