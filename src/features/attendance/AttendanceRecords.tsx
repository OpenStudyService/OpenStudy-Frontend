import { useTableSort } from "../../shared/ui/table-sort";
import { readFlatListPage } from "../../shared/api/read-sorted-pages";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin } from "../../shared/domain/schema";
import { Button, ErrorState, Panel } from "../../shared/ui/primitives";
import { hasBlockingReadError } from "../../shared/api/read-model";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import {
  attendanceApi,
  workedTime,
  type AttendanceRecord,
} from "./attendance-api";
import { shiftTime } from "./api";
import { CorrectionForm } from "./RequestForms";

const PAGE_SIZE = 20;
// 초기화 대상: 목록 필터와 페이지. tab은 남긴다.
const RECORD_FILTER_KEYS = [
  "from",
  "to",
  "status",
  "mine",
  "employeeId",
  "page",
  "sort",
  "direction",
];

export function AttendanceRecords() {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
  const sorting = useTableSort({ sort: "clockInAt", direction: "desc" });
  const from = params.get("from") || "",
    to = params.get("to") || "",
    status = params.get("status") || "",
    mine = params.get("mine") || "",
    employeeId = params.get("employeeId") || "",
    detail = params.get("detail") || "";
  const page = Math.max(1, Number(params.get("page")) || 1),
    manager = admin(session.user, scope);
  function filter(key: string, value: string) {
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key !== "page") p.delete("page");
      p.delete("detail");
      return p;
    });
  }
  const rows = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "attendance-records",
      from,
      to,
      status,
      mine,
      employeeId,
      page,
      params.has("sort"),
      sorting.value,
    ],
    queryFn: async ({ signal }) => {
      const read = (page: number, pageSize: number) =>
        attendanceApi.list(
          {
            scope,
            from,
            to,
            status,
            mine: manager ? mine : "true",
            employeeId: manager ? employeeId : undefined,
            page,
            pageSize,
          },
          signal,
        );
      if (!params.has("sort")) return read(page, PAGE_SIZE);
      const values = {
        employee: (r: AttendanceRecord) => r.employee.name,
        branch: (r: AttendanceRecord) =>
          lookups.branches.find((b) => b.id === r.branchId)?.name ?? r.branchId,
        clockInAt: (r: AttendanceRecord) => Date.parse(r.clockInAt),
        clockOutAt: (r: AttendanceRecord) =>
          r.clockOutAt ? Date.parse(r.clockOutAt) : null,
        status: (r: AttendanceRecord) => r.status,
        worked: (r: AttendanceRecord) => r.workedMinutes,
      };
      const value = sorting.fallback(values);
      if (!value) return read(page, PAGE_SIZE);
      return readFlatListPage(
        read,
        page,
        PAGE_SIZE,
        sorting.value.direction,
        value,
      );
    },
    retry: false,
  });
  return (
    <section>
      <ListCard>
        <ListFilters>
          <span className="flex flex-wrap items-center gap-2">
            <span className="w-full text-xs text-muted sm:w-auto">출근일</span>
            <input
              type="date"
              aria-label="출근 시작일"
              className="w-full min-w-0 sm:w-auto"
              value={from}
              onChange={(e) => filter("from", e.target.value)}
            />
            <span aria-hidden="true" className="hidden sm:inline">
              ~
            </span>
            <input
              type="date"
              aria-label="출근 종료일"
              className="w-full min-w-0 sm:w-auto"
              value={to}
              onChange={(e) => filter("to", e.target.value)}
            />
          </span>
          <select
            aria-label="근태 상태"
            value={status}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {["근무 중", "휴게 중", "퇴근"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {manager && (
            <>
              <select
                aria-label="조회 대상"
                value={mine}
                onChange={(e) => filter("mine", e.target.value)}
              >
                <option value="">권한 범위 전체</option>
                <option value="true">본인만</option>
              </select>
              <select
                aria-label="근태 직원"
                value={employeeId}
                onChange={(e) => filter("employeeId", e.target.value)}
              >
                <option value="">전체 직원</option>
                {lookups.employees.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            variant="quiet"
            onClick={() =>
              setParams((p) => {
                RECORD_FILTER_KEYS.forEach((key) => p.delete(key));
                return p;
              })
            }
          >
            초기화
          </Button>
        </ListFilters>
        <p className="px-5 py-3 text-xs text-muted">
          실제 출퇴근 기록 · Asia/Seoul · 출근한 날짜 기준 · 실근무 분은 서버
          계산값입니다.
        </p>
        <ListTable
          label="출퇴근 기록"
          columns={[
            sorting.column("직원", "employee"),
            sorting.column("기록 지점", "branch"),
            sorting.column("출근", "clockInAt"),
            sorting.column("퇴근", "clockOutAt"),
            sorting.column("상태", "status"),
            sorting.column("실근무 분", "worked"),
          ]}
          loading={rows.isPending}
          error={hasBlockingReadError(rows) ? rows.error : null}
          onRetry={() => void rows.refetch()}
          isEmpty={!rows.data?.items.length}
          empty={{ title: "조건에 맞는 실제 출퇴근 기록이 없습니다." }}
        >
          {rows.data?.items.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="cell-link"
                  onClick={() =>
                    setParams((p) => {
                      p.set("detail", r.id);
                      return p;
                    })
                  }
                >
                  {r.employee.name}
                </button>
              </td>
              <td>
                {lookups.branches.find((b) => b.id === r.branchId)?.name ||
                  r.branchId}
              </td>
              <td>{shiftTime(r.clockInAt)}</td>
              <td>{r.clockOutAt ? shiftTime(r.clockOutAt) : "진행 중"}</td>
              <td>{r.status}</td>
              <td>{workedTime(r.workedMinutes)}</td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.data?.total ?? 0}
          loading={rows.isPending}
          error={!!rows.error}
          onChange={(value) => filter("page", String(value))}
        />
      </ListCard>
      <Panel
        open={!!detail}
        title="실제 출퇴근 상세"
        description="예정 근무와 실제 기록, 휴게 구간을 구분해 확인합니다."
        onClose={() =>
          setParams((p) => {
            p.delete("detail");
            return p;
          })
        }
      >
        {detail && (
          <RecordDetail
            key={`${session.user.id}:${scope}:${detail}`}
            id={detail}
          />
        )}
      </Panel>
    </section>
  );
}
function RecordDetail({ id }: { id: string }) {
  const { session, scope, lookups } = useApp();
  const [read] = useState(() => crypto.randomUUID());
  const detail = useQuery({
    queryKey: ["data", session.user.id, scope, "attendance-records", id, read],
    queryFn: ({ signal }) => attendanceApi.get(id, signal),
    retry: false,
    gcTime: 0,
  });
  if (detail.isPending) return <p>근태를 불러오고 있어요.</p>;
  if (detail.error)
    return (
      <ErrorState error={detail.error} retry={() => void detail.refetch()} />
    );
  const row = detail.data!;
  return (
    <div className="grid gap-4">
      <h3>
        {row.employee.name} ·{" "}
        {lookups.branches.find((b) => b.id === row.branchId)?.name ||
          row.branchId}
      </h3>
      <RecordFacts row={row} />
      <h3>실제 휴게 구간</h3>
      {row.breaks.length ? (
        row.breaks.map((b) => (
          <p key={b.id}>
            {shiftTime(b.startedAt)} ~{" "}
            {b.endedAt ? shiftTime(b.endedAt) : "휴게 중"}
          </p>
        ))
      ) : (
        <p>휴게 기록이 없습니다.</p>
      )}
      <CorrectionForm row={row} />
    </div>
  );
}
export function RecordFacts({ row }: { row: AttendanceRecord }) {
  return (
    <>
      <p>상태: {row.status}</p>
      <p>출근: {shiftTime(row.clockInAt)}</p>
      <p>퇴근: {row.clockOutAt ? shiftTime(row.clockOutAt) : "진행 중"}</p>
      <p>실근무: {workedTime(row.workedMinutes)}</p>
      <p>
        {row.shiftId
          ? `연결된 예정 근무: ${row.shiftId}`
          : "연결된 예정 근무 없음"}
      </p>
    </>
  );
}
