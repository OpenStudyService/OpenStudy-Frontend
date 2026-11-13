import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, ApiError } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { can } from "../../shared/domain/schema";
import { Button, FieldError } from "../../shared/ui/primitives";
import type {
  AiConditions,
  AiContext,
  AiEditableFilters,
  AiRefinement,
} from "./ai-reuse-api";
import { POC_QUESTIONS, type GeneratedConditions } from "./domainlens";

const CONDITION_NAMES: Record<AiContext["changed"][number], string> = {
  ANALYSIS: "분석 종류",
  PERIOD: "기간",
  BRANCHES: "지점",
  PRODUCTS: "상품",
  REFUND_BASIS: "환불 집계 기준",
  ZERO_FILL: "데이터 없는 구간 0으로 표시",
};

export function analysisName(id: string) {
  return POC_QUESTIONS.find((poc) => poc.analysisId === id)?.shortLabel ?? id;
}

export function reuseFailure(error: unknown) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "조회하지 못했어요.";
  }
  const reason: Record<string, string> = {
    AI_PERMISSION_DENIED: "AI 분석 조회 권한이 없어요.",
    BRANCH_SCOPE_DENIED: "조회 조건에 접근 권한이 없는 지점이 있어요.",
    SALES_PERMISSION_DENIED: "조회 조건에 매출 조회 권한이 없는 지점이 있어요.",
    AUTHORIZATION_SCOPE_CHECK: "현재 권한으로 조회 범위를 확인할 수 없어요.",
  };
  const code = error.detail.code;
  if (error.status === 403 && reason[code])
    return `${reason[code]} 조회 범위를 줄여 조건을 변경하거나 다시 질문해 주세요.`;
  if (error.status === 403) return `${error.message} 다시 질문해 주세요.`;
  if (
    code === "NOT_EXECUTABLE" ||
    code === "ANALYSIS_UNAVAILABLE" ||
    error.status === 404
  )
    return `${error.message} 다시 질문해 주세요.`;
  if (error.status === 429)
    return "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
  return error.message;
}

export function ReuseError({ error }: { error: unknown }) {
  return (
    <FieldError>
      {reuseFailure(error)}
      {error instanceof ApiError &&
        Object.entries(error.detail.fieldErrors ?? {}).map(
          ([field, message]) => (
            <span className="block" key={field}>
              {message}
            </span>
          ),
        )}
    </FieldError>
  );
}

export function ContextSummary({ context }: { context?: AiContext | null }) {
  // The response is untrusted: an answer built on no earlier result may carry an empty context ({}).
  if (!context || !Array.isArray(context.inherited) || !Array.isArray(context.changed))
    return null;
  const reset =
    context.reset &&
    (context.resetReason === "SCOPE_CHANGED"
      ? "선택 지점 범위가 바뀌어 이전 조건을 이어받지 않았어요."
      : context.resetReason === "PERMISSION_LOST"
        ? "이전 결과의 지점 권한이 바뀌어 조건을 이어받지 않았어요."
        : null);
  return (
    <>
      {context.inherited.length > 0 && (
        <p className="help">
          <b>유지</b>{" "}
          {context.inherited.map((item) => CONDITION_NAMES[item]).join(", ")}
        </p>
      )}
      {context.changed.length > 0 && (
        <p className="help">
          <b>변경된 조건</b>{" "}
          {context.changed.map((item) => CONDITION_NAMES[item]).join(", ")}
        </p>
      )}
      {reset && <p className="tip">{reset}</p>}
    </>
  );
}

export function useAiConditionEntries(
  conditions?: AiConditions | null,
  generated?: GeneratedConditions,
) {
  const { session, lookups } = useApp();
  if (!conditions) return [];
  const productNames = new Map(
    lookups?.products.map(({ id, name }) => [id, name]),
  );
  const branches = session.branches.filter(({ id }) => can(session.user, id));
  const branchNames = new Map(branches.map(({ id, name }) => [id, name]));
  const branchText = conditions.branchIds
    .map((id) => branchNames.get(id) ?? "현재 볼 수 없는 지점")
    .join(", ");
  // OpenStudy-Frontend#122: a generated result has no registered analysis; its conditions come from its QuerySpec.
  if (generated)
    return [
      [CONDITION_NAMES.ANALYSIS, "AI 생성 조회"],
      ["지표", generated.metrics.join(", ") || "없음"],
      ["묶음", generated.dimensions.join(", ") || "없음"],
      [
        CONDITION_NAMES.PERIOD,
        generated.period
          ? `${generated.period.from} ~ ${generated.period.to}`
          : "기간 조건 없음",
      ],
      [CONDITION_NAMES.BRANCHES, branchText],
    ] as const;
  const values = {
    ANALYSIS: analysisName(conditions.analysisId),
    PERIOD: conditions.period
      ? `${conditions.period.from} ~ ${conditions.period.to}${conditions.periodSource === "EDITED" ? " · 변경한 기간" : conditions.periodSource === "DEFAULT" ? " · 기본 기간" : ""}`
      : "실시간",
    BRANCHES: branchText,
    PRODUCTS:
      conditions.productIds
        .map((id) => productNames.get(id) ?? id)
        .join(", ") || "전체",
    REFUND_BASIS:
      conditions.refundBasis === "original"
        ? "원결제일"
        : conditions.refundBasis === "processed"
          ? "환불 처리일"
          : "해당 없음",
    ZERO_FILL:
      conditions.zeroFill === null
        ? "해당 없음"
        : conditions.zeroFill
          ? "사용"
          : "사용 안 함",
  };
  return Object.entries(values).map(
    ([key, value]) =>
      [CONDITION_NAMES[key as keyof typeof values], value] as const,
  );
}

export function AppliedConditions({
  conditions,
  editable,
  disabled,
  onRefine,
  generated,
}: {
  conditions: AiConditions;
  editable?: AiEditableFilters | null;
  disabled: boolean;
  onRefine?: (body: AiRefinement) => Promise<void>;
  /** A generated result shows its QuerySpec conditions and offers no condition editing (first scope of #122). */
  generated?: GeneratedConditions;
}) {
  const [editing, setEditing] = useState(false);
  const entries = useAiConditionEntries(conditions, generated);
  const refinable = generated ? null : editable;
  return (
    <div className="grid gap-2">
      <h4 className="text-xs font-semibold">적용 조건</h4>
      <dl className="grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
        {entries.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-x-2">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {refinable &&
        onRefine &&
        (editing ? (
          <RefinementForm
            conditions={conditions}
            editable={refinable}
            disabled={disabled}
            onCancel={() => setEditing(false)}
            onRefine={async (body) => {
              await onRefine(body);
              setEditing(false);
            }}
          />
        ) : (
          <div>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              조건 변경
            </Button>
          </div>
        ))}
    </div>
  );
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

const DAY_MS = 86_400_000;

function RefinementForm({
  conditions,
  editable,
  disabled,
  onRefine,
  onCancel,
}: {
  conditions: AiConditions;
  editable: AiEditableFilters;
  disabled: boolean;
  onRefine: (body: AiRefinement) => Promise<void>;
  onCancel: () => void;
}) {
  const { session, scope, lookups } = useApp();
  const requiresSalesRead = POC_QUESTIONS.some(
    (poc) => poc.analysisId === conditions.analysisId && poc.requiresSalesRead,
  );
  const branchOptions = session.branches.filter(
    ({ id }) =>
      can(session.user, id, "ai:read") &&
      (!requiresSalesRead || can(session.user, id, "sales:read")),
  );
  const selectableBranchIds = branchOptions.map(({ id }) => id);
  const [branchIds, setBranchIds] = useState(conditions.branchIds);
  const unavailableBranches = branchIds.some(
    (id) => !selectableBranchIds.includes(id),
  );
  const [productIds, setProductIds] = useState(conditions.productIds);
  const [from, setFrom] = useState(conditions.period?.from ?? "");
  const [to, setTo] = useState(conditions.period?.to ?? "");
  const [error, setError] = useState<unknown>();
  const [submission, setSubmission] = useState<{
    changes: string;
    key: string;
  }>();
  const products = useQuery({
    queryKey: ["data", session.user.id, "all", "lookups", "ai-refinement"],
    queryFn: ({ signal }) =>
      api<components["schemas"]["Lookups"]>("/lookups?scope=all", { signal }),
    enabled: editable.products && scope !== "all",
    retry: false,
  });
  const productOptions = (
    products.data?.products ??
    lookups?.products ??
    []
  ).filter((product) => product.branchIds.some((id) => branchIds.includes(id)));
  const knownProducts = new Map(
    productOptions.map(({ id, name }) => [id, name]),
  );
  const visibleProducts = [
    ...productOptions,
    ...productIds
      .filter((id) => !knownProducts.has(id))
      .map((id) => ({ id, name: id })),
  ];

  async function submit() {
    const body: AiRefinement = {};
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (
      editable.period &&
      (from !== conditions.period?.from || to !== conditions.period?.to)
    ) {
      if (!Number.isFinite(days) || days < 1) {
        setError(new Error("시작 날짜와 종료 날짜를 순서대로 입력해 주세요."));
        return;
      }
      if (days > editable.period.maxDays) {
        setError(
          new Error(
            `기간은 최대 ${editable.period.maxDays}일까지 고를 수 있어요.`,
          ),
        );
        return;
      }
      body.period = { from, to };
    }
    if (
      !branchIds.length ||
      (editable.branches.single && branchIds.length !== 1)
    ) {
      setError(
        new Error(
          editable.branches.single
            ? "지점을 하나 골라 주세요."
            : "지점을 하나 이상 골라 주세요.",
        ),
      );
      return;
    }
    if (unavailableBranches) {
      setError(
        new Error("현재 조회할 수 없는 지점을 제외한 뒤 다시 시도해 주세요."),
      );
      return;
    }
    if (!sameIds(branchIds, conditions.branchIds)) body.branchIds = branchIds;
    if (editable.products && !sameIds(productIds, conditions.productIds)) {
      if (productIds.length > 20) {
        setError(new Error("상품은 최대 20개까지 고를 수 있어요."));
        return;
      }
      body.productIds = productIds;
    }
    if (Object.keys(body).length === 0) {
      setError(new Error("원래 조건과 같아요. 바꿀 조건을 골라 주세요."));
      return;
    }
    const changes = JSON.stringify(body);
    const key =
      submission?.changes === changes ? submission.key : crypto.randomUUID();
    setSubmission({ changes, key });
    setError(undefined);
    try {
      await onRefine({ ...body, clientRequestKey: key });
    } catch (error) {
      setError(error);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-lg border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={disabled} className="grid gap-3">
        {editable.period && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="field">
              시작 날짜
              <input
                type="date"
                value={from}
                required
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="field">
              종료 날짜
              <input
                type="date"
                value={to}
                min={from}
                required
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <p className="help sm:col-span-2">
              한국 날짜 기준으로 양 끝을 포함해 최대 {editable.period.maxDays}
              일을 고를 수 있어요.
            </p>
          </div>
        )}
        <fieldset>
          <legend className="text-xs font-semibold">
            {editable.branches.single ? "지점 1개 선택" : "지점 선택"}
          </legend>
          {unavailableBranches && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="help">
                이 결과에 현재 조회할 수 없는 지점이 있어요.
              </p>
              <Button
                type="button"
                onClick={() =>
                  setBranchIds(
                    branchIds.filter((id) => selectableBranchIds.includes(id)),
                  )
                }
              >
                조회할 수 없는 지점 제외
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {branchOptions.map(({ id, name }) => (
              <label key={id} className="flex items-center gap-1">
                <input
                  type={editable.branches.single ? "radio" : "checkbox"}
                  checked={branchIds.includes(id)}
                  onChange={(event) =>
                    setBranchIds(
                      editable.branches.single
                        ? [id]
                        : event.target.checked
                          ? [...branchIds, id]
                          : branchIds.filter((branchId) => branchId !== id),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        {editable.products && (
          <fieldset>
            <legend className="text-xs font-semibold">상품 선택</legend>
            <p className="help">
              최대 20개까지 선택할 수 있어요. 비워 두면 전체 상품을 조회해요.
            </p>
            {products.error && <ReuseError error={products.error} />}
            <div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto">
              {visibleProducts.map(({ id, name }) => (
                <label key={id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={productIds.includes(id)}
                    disabled={
                      !productIds.includes(id) && productIds.length >= 20
                    }
                    onChange={(event) =>
                      setProductIds(
                        event.target.checked
                          ? [...productIds, id]
                          : productIds.filter((productId) => productId !== id),
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            변경한 조건으로 조회
          </Button>
          <Button type="button" onClick={onCancel}>
            취소
          </Button>
        </div>
      </fieldset>
      {error != null && <ReuseError error={error} />}
    </form>
  );
}
