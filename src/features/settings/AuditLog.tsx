import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api, ApiError } from "../../shared/api/client";
import { formatBusinessDate, formatDateTime } from "../../shared/domain/format";
import { Button, FieldError, Heading, State } from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Field } from "../organization/shared";
import {
  auditPeriodError,
  auditResults,
  auditSearchKeys,
  auditSearchParams,
  type AuditDetail,
  type AuditPage,
} from "./audit-model";
import {
  AuditDetailPanel,
  AuditReadError,
  auditRef,
  auditTarget,
} from "./AuditDetail";

const DEFAULT_PAGE_SIZE = 20;

export function AuditLog() {
  const { session } = useApp();
  if (!session.user.owner || session.user.status !== "활성")
    return (
      <div className="page">
        <State
          title="변경 이력을 볼 권한이 없어요"
          message="OWNER만 변경 이력을 조회할 수 있습니다."
        />
      </div>
    );
  return (
    <div className="page">
      <Heading
        title="변경 이력"
        description="작업자와 변경 전후 내용을 확인해요."
      />
      <AuditSearch key={session.user.id} ownerId={session.user.id} />
    </div>
  );
}

function AuditSearch({ ownerId }: { ownerId: string }) {
  const [params, setParams] = useSearchParams();
  const query = auditSearchParams(params);
  const periodError = auditPeriodError(
    query.get("from") || "",
    query.get("to") || "",
  );
  const data = useQuery({
    queryKey: ["data", ownerId, "audit-events", query.toString()],
    queryFn: ({ signal }) =>
      api<AuditPage>(`/audit-events?${query}`, { signal }),
    enabled: !periodError,
    retry: false,
  });
  const detail = params.get("detail") || "";
  function showDetail(id: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("detail", id);
      else next.delete("detail");
      return next;
    });
  }
  function sameRequest(event: AuditDetail) {
    const next = new URLSearchParams({
      requestId: event.requestId!,
    });
    const period = data.data?.period;
    const eventDate = formatBusinessDate(event.occurredAt);
    if (period && period.from <= eventDate && period.to >= eventDate) {
      next.set("from", period.from);
      next.set("to", period.to);
    } else {
      // Keep an old directly linked event inside the seven-day period.
      next.set("from", eventDate);
    }
    setParams(next);
  }
  const formKey = auditSearchParams(params);
  formKey.delete("page");
  const error = data.error;
  const result = data.data;
  let tableState;
  if (periodError) {
    tableState = <FieldError>{periodError}</FieldError>;
  } else if (error) {
    const detail = error instanceof ApiError ? error.detail : undefined;
    tableState = (
      <>
        {detail?.code === "PERIOD_TOO_LONG" ? (
          <FieldError>
            조회 기간은 최대 92일입니다. 기간을 줄여 주세요.
          </FieldError>
        ) : (
          <AuditReadError error={error} retry={() => void data.refetch()} />
        )}
        {detail?.fieldErrors && (
          <ul>
            {Object.entries(detail.fieldErrors).map(([field, message]) => (
              <li key={field}>
                <FieldError>
                  {field} · {message}
                </FieldError>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <section aria-label="변경 이력 검색">
      <ListCard>
        <AuditFilters
          key={`filters:${formKey}`}
          params={params}
          onSearch={(values) => {
            setParams((current) => {
              const next = new URLSearchParams(current);
              for (const key of auditSearchKeys) next.delete(key);
              next.delete("detail");
              for (const [key, value] of values) next.set(key, value);
              next.set("page", "1");
              return next;
            });
          }}
          onReset={() => {
            if (!query.size) return;
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                for (const key of auditSearchKeys) next.delete(key);
                return next;
              },
              { replace: true },
            );
          }}
        />
        {result && !tableState && (
          <p className="px-4 py-3 text-xs text-muted">
            적용 기간 (서울 날짜) · {result.period.from} ~ {result.period.to}
          </p>
        )}
        <ListTable
          label="변경 이력 검색 결과"
          columns={[
            "시각",
            "행위",
            "결과",
            "대상",
            "작업자",
            "지점",
            "사유",
            "요청 ID",
            "변경 내용",
          ]}
          state={tableState}
          loading={data.isPending}
          isEmpty={!result?.items.length}
          empty={{ title: "조건에 맞는 변경 이력이 없어요" }}
        >
          {result?.items.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.occurredAt)}</td>
              <td>
                <button
                  type="button"
                  className="cell-link"
                  aria-label={`감사 기록 ${event.id} 상세: ${event.action}`}
                  onClick={() => showDetail(event.id)}
                >
                  {event.action}
                </button>
              </td>
              <td>{event.result}</td>
              <td>{auditTarget(event)}</td>
              <td>{auditRef(event.actor, "시스템 / 알 수 없음")}</td>
              <td>{auditRef(event.branch, "지점 없음 / 알 수 없음")}</td>
              <td className="whitespace-pre-wrap">{event.reason ?? "—"}</td>
              <td className="break-all">{event.requestId ?? "—"}</td>
              <td>{event.hasChanges ? "변경 내용 있음" : "—"}</td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={result?.meta.page ?? 1}
          pageSize={result?.meta.pageSize ?? DEFAULT_PAGE_SIZE}
          total={result?.meta.total ?? 0}
          loading={data.isPending}
          error={!!tableState}
          onChange={(page) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("page", String(page));
              next.delete("detail");
              return next;
            })
          }
        />
      </ListCard>
      <AuditDetailPanel
        key={`detail:${detail}`}
        id={detail}
        ownerId={ownerId}
        onClose={() => showDetail("")}
        onSameRequest={sameRequest}
      />
    </section>
  );
}

const textFilters = [
  ["entityType", "대상 유형", 80],
  ["entityId", "대상 ID", undefined],
  ["action", "행위", 80],
  ["actorEmployeeId", "작업자 ID", undefined],
  ["branchId", "지점 ID", undefined],
  ["requestId", "요청 ID", 128],
] as const;

function AuditFilters({
  params,
  onSearch,
  onReset,
}: {
  params: URLSearchParams;
  onSearch: (query: URLSearchParams) => void;
  onReset: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      aria-label="감사 로그 검색 조건"
      onReset={() => {
        setError("");
        onReset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget)) {
          if (typeof value === "string" && value !== "") values.set(key, value);
        }
        const failure =
          auditPeriodError(values.get("from") || "", values.get("to") || "") ||
          (values.has("entityId") && !values.has("entityType")
            ? "대상 ID는 대상 유형과 함께 입력해 주세요."
            : "");
        setError(failure || "");
        if (!failure) onSearch(values);
      }}
    >
      <ListFilters
        actions={
          <>
            <Button type="reset" variant="quiet">
              초기화
            </Button>
            <Button type="submit" variant="primary">
              검색
            </Button>
          </>
        }
      >
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
          <Field label="시작일">
            <input
              name="from"
              type="date"
              defaultValue={params.get("from") || ""}
            />
          </Field>
          <Field label="종료일">
            <input
              name="to"
              type="date"
              defaultValue={params.get("to") || ""}
            />
          </Field>
        </div>
        <Field label="결과">
          <select name="result" defaultValue={params.get("result") || ""}>
            <option value="">전체</option>
            {auditResults.map((result) => (
              <option key={result} value={result}>
                {result}
              </option>
            ))}
          </select>
        </Field>
      </ListFilters>
      <div className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        {textFilters.map(([key, label, max]) => (
          <Field key={key} label={label}>
            <input
              name={key}
              defaultValue={params.get(key) || ""}
              maxLength={max}
            />
          </Field>
        ))}
        <Field label="페이지당 항목 수">
          <input
            type="number"
            min={1}
            max={100}
            name="pageSize"
            defaultValue={params.get("pageSize") || DEFAULT_PAGE_SIZE}
          />
        </Field>
        <p className="help sm:col-span-2 lg:col-span-4">
          대상 유형과 행위는 계약 코드를 정확히 입력해 주세요. 기간을 생략하면
          최근 7일을 조회합니다.
        </p>
        {error && (
          <div className="sm:col-span-2 lg:col-span-4">
            <FieldError>{error}</FieldError>
          </div>
        )}
      </div>
    </form>
  );
}
