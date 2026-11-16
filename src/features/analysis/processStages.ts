import type { StageSpanDto } from "./domainlens";

/** A stage time as people read it: milliseconds under a second, else seconds. */
export function seconds(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`;
}

/**
 * How the answer's query plan was made, read from the plan stage the server reports: the model, the plan cache
 * (no model call), or the registered rules.
 */
export function planSource(stages: StageSpanDto[]) {
  const plan = stages.find((stage) => stage.stage === "generating");
  if (!plan) return null;
  const text = `${plan.label ?? ""} ${plan.detail ?? ""}`;
  if (text.includes("재사용"))
    return { label: "캐시 재사용", note: "LLM 호출 없음" };
  if (/LLM|Qwen|qwen|DomainLens 조회 계획 생성/.test(text))
    return { label: "LLM 호출", note: seconds(plan.durationMs ?? 0) };
  return { label: "등록 분석 규칙", note: "LLM 호출 없음" };
}
