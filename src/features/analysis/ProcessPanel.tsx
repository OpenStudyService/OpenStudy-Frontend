import { useEffect } from "react";
import { Icon } from "../../shared/ui/Icon";
import type { StageSpanDto } from "./domainlens";
import { planSource, seconds } from "./processStages";

/** One answer's processing record, as the panel shows it. */
export interface ProcessTurn {
  question: string;
  askedAt: string;
  loading: boolean;
  stages: StageSpanDto[];
}

const STATUS_TEXT: Record<string, string> = {
  COMPLETED: "완료",
  CLARIFICATION: "되묻기",
  UNSUPPORTED: "지원 안 함",
  REJECTED: "거절",
  DENIED: "거절",
  FAILED: "실패",
};

function tone(status: string) {
  if (status === "COMPLETED") return "done";
  if (status === "CLARIFICATION" || status === "UNSUPPORTED") return "warn";
  return "stop";
}

/**
 * The right-hand sidebar of the AI chat: one answer's processing steps as a vertical pipeline (DomainLens trace in
 * the result mock-up), each with its status, detail and time, and a bar for its share of the total time.
 */
export function ProcessPanel({
  turn,
  open,
  onClose,
}: {
  turn: ProcessTurn | null;
  open: boolean;
  onClose: () => void;
}) {
  // On narrow screens the panel is a drawer: Escape closes it like the close button.
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);
  const total =
    turn?.stages.reduce((sum, stage) => sum + (stage.durationMs ?? 0), 0) ?? 0;
  const longest = Math.max(
    1,
    ...(turn?.stages.map((stage) => stage.durationMs ?? 0) ?? [0]),
  );
  const source = turn ? planSource(turn.stages) : null;
  const time = turn
    ? new Date(turn.askedAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <aside
      className={`chat-trace ${open ? "open" : ""}`}
      aria-labelledby="ai-trace-title"
    >
      <header className="chat-trace-head">
        <div className="min-w-0">
          <h3 id="ai-trace-title">처리 과정</h3>
          {turn && (
            <p className="chat-trace-question" title={turn.question}>
              {turn.question}
              <time dateTime={turn.askedAt}> · {time}</time>
            </p>
          )}
        </div>
        <button
          type="button"
          className="chat-trace-close"
          aria-label="처리 과정 닫기"
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      {!turn ? (
        <p className="help px-4 py-6">
          질문하면 답변이 어떤 단계를 거쳐 얼마나 걸렸는지 여기에 보여요.
        </p>
      ) : turn.loading ? (
        <p
          className="flex items-center gap-2 px-4 py-6 text-muted"
          role="status"
        >
          <span className="spinner !h-4 !w-4" aria-hidden="true" />
          처리 중이에요. 단계별 기록은 답변과 함께 도착해요.
        </p>
      ) : turn.stages.length === 0 ? (
        <p className="help px-4 py-6">이 답변에는 처리 기록이 없어요.</p>
      ) : (
        <>
          <dl className="chat-trace-summary">
            <div>
              <dt>총 소요</dt>
              <dd>{seconds(total)}</dd>
            </div>
            <div>
              <dt>단계</dt>
              <dd>{turn.stages.length}개</dd>
            </div>
            {source && (
              <div>
                <dt>조회 계획</dt>
                <dd>
                  {source.label}
                  <small>{source.note}</small>
                </dd>
              </div>
            )}
          </dl>
          <ol className="trace-steps" aria-label="처리 단계">
            {turn.stages.map((stage, i) => {
              const ms = stage.durationMs ?? 0;
              return (
                <li
                  key={`${stage.stage}-${i}`}
                  className={`trace-step ${tone(stage.status)}`}
                >
                  <span className="trace-step-icon" aria-hidden="true">
                    {stage.status === "COMPLETED" ? (
                      <Icon name="check" size={12} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="trace-step-head">
                      <b>{stage.label ?? stage.stage}</b>
                      <span className="tabular-nums">{seconds(ms)}</span>
                    </div>
                    {stage.status !== "COMPLETED" && (
                      <span className="trace-step-status">
                        {STATUS_TEXT[stage.status] ?? stage.status}
                      </span>
                    )}
                    {stage.detail && (
                      <p className="trace-step-detail">{stage.detail}</p>
                    )}
                    <span
                      className="trace-step-bar"
                      style={{ width: `${Math.max(2, (ms / longest) * 100)}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </aside>
  );
}
