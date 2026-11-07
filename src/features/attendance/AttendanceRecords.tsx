import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin } from "../../shared/domain/schema";
import { Button, ErrorState, Panel } from "../../shared/ui/primitives";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
import {
  attendanceApi,
  workedTime,
  type AttendanceRecord,
} from "./attendance-api";
import { shiftTime } from "./api";

export function AttendanceRecords() {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
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
    ],
    queryFn: ({ signal }) =>
      attendanceApi.list(
        {
          scope,
          from,
          to,
          status,
          mine: manager ? mine : "true",
          employeeId: manager ? employeeId : undefined,
          page,
          pageSize: 20,
        },
        signal,
      ),
    retry: false,
  });
  return (
    <section>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label>
          출근 시작일
          <input
            type="date"
            value={from}
            onChange={(e) => filter("from", e.target.value)}
          />
        </label>
        <label>
          출근 종료일
          <input
            type="date"
            value={to}
            onChange={(e) => filter("to", e.target.value)}
          />
        </label>
        <label>
          근태 상태
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
        </label>
        {manager && (
          <>
            <label>
              조회 대상
              <select
                aria-label="조회 대상"
                value={mine}
                onChange={(e) => filter("mine", e.target.value)}
              >
                <option value="">권한 범위 전체</option>
                <option value="true">본인만</option>
              </select>
            </label>
            <label>
              근태 직원
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
            </label>
          </>
        )}
        <Button disabled={rows.isFetching} onClick={() => void rows.refetch()}>
          근태 목록 새로고침
        </Button>
      </div>
      <p className="help px-4">
        실제 출퇴근 기록 · Asia/Seoul · 출근한 날짜 기준 · 실근무 분은 서버
        계산값입니다.
      </p>
      <DataNotice
        label="근태 목록"
        loading={rows.isPending}
        error={rows.error}
        retry={() => void rows.refetch()}
      />
      {!hasBlockingReadError(rows) && (
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>직원</th>
                <th>기록 지점</th>
                <th>출근</th>
                <th>퇴근</th>
                <th>상태</th>
                <th>실근무 분</th>
              </tr>
            </thead>
            <tbody>
              {rows.data?.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee.name}</td>
                  <td>
                    {lookups.branches.find((b) => b.id === r.branchId)?.name ||
                      r.branchId}
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        setParams((p) => {
                          p.set("detail", r.id);
                          return p;
                        })
                      }
                    >
                      {shiftTime(r.clockInAt)}
                    </button>
                  </td>
                  <td>{r.clockOutAt ? shiftTime(r.clockOutAt) : "진행 중"}</td>
                  <td>{r.status}</td>
                  <td>{workedTime(r.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.data?.items.length === 0 && (
            <p>조건에 맞는 실제 출퇴근 기록이 없습니다.</p>
          )}
        </div>
      )}
      <div className="flex gap-3 p-4">
        <Button
          disabled={page <= 1}
          onClick={() => filter("page", String(page - 1))}
        >
          이전
        </Button>
        <span>
          {page}페이지 · {rows.data?.total ?? 0}건
        </span>
        <Button
          disabled={!rows.data || page * 20 >= rows.data.total}
          onClick={() => filter("page", String(page + 1))}
        >
          다음
        </Button>
      </div>
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
      <p className="help">다른 직원의 출퇴근을 대신 변경할 수 없습니다.</p>
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
