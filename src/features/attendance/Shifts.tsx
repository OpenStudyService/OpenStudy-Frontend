import { useDraftGuard } from "../../shared/ui/leaveGuard";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api, ApiError, queryString } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { admin, businessDate } from "../../shared/domain/schema";
import { Button, ErrorState, Panel } from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { WeekSchedule } from "./WeekSchedule";
import {
  getShift,
  seoulInput,
  seoulInstant,
  type Shift,
  type Conflict,
  shiftTime as displayDate,
} from "./api";

export function Shifts() {
  const { session, scope } = useApp();
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const view = params.get("view") || "week",
    detail = params.get("detail") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const from = params.get("from") || "",
    to = params.get("to") || "";
  const status = params.get("status") || "예정";
  function filter(name: string, value: string) {
    setParams((p) => {
      p.set(name, value);
      if (name !== "page") p.delete("page");
      return p;
    });
  }
  const rows = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "shifts",
      "list",
      page,
      from,
      to,
      status,
    ],
    queryFn: async ({ signal }) =>
      asPage<Shift>(
        await api(
          `/shifts?${queryString({ scope, page, pageSize: 20, from, to, status })}`,
          { signal },
        ),
      ),
    enabled: view === "list",
    retry: false,
  });
  const select = (id: string) =>
    setParams((p) => {
      p.set("detail", id);
      return p;
    });
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Button onClick={() => filter("view", "week")}>주간 보기</Button>
        <Button onClick={() => filter("view", "list")}>목록 보기</Button>
        {admin(session.user, scope) && (
          <Button variant="primary" onClick={() => setCreate(true)}>
            근무 등록
          </Button>
        )}
      </div>
      {view === "week" ? (
        <WeekSchedule onSelect={select} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3 p-4">
            <label>
              시작일
              <input
                type="date"
                value={from}
                onChange={(e) => filter("from", e.target.value)}
              />
            </label>
            <label>
              종료일
              <input
                type="date"
                value={to}
                onChange={(e) => filter("to", e.target.value)}
              />
            </label>
            <label>
              근무 상태
              <select
                aria-label="근무 상태"
                value={status}
                onChange={(e) => filter("status", e.target.value)}
              >
                <option value="예정">예정</option>
                <option value="취소">취소</option>
              </select>
            </label>
          </div>
          <DataNotice
            label="근무 목록"
            loading={rows.isPending}
            error={rows.error}
            retry={() => void rows.refetch()}
          />
          {!rows.error && (
            <div className="data-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>직원</th>
                    <th>예정 근무 (Asia/Seoul)</th>
                    <th>예정 휴게</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data?.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.employee.name}</td>
                      <td>
                        <button onClick={() => select(s.id)}>
                          {displayDate(s.startsAt)} ~ {displayDate(s.endsAt)}
                        </button>
                      </td>
                      <td>{s.plannedBreakMinutes}분</td>
                      <td>{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.data?.items.length === 0 && (
                <p>조건에 맞는 근무가 없어요.</p>
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
        </>
      )}
      <Panel
        open={create || !!detail}
        title={create ? "근무 등록" : "예정 근무 상세"}
        onClose={() => {
          setCreate(false);
          setParams((p) => {
            p.delete("detail");
            return p;
          });
        }}
      >
        {(create || detail) && (
          <ShiftPanel
            key={`${session.user.id}:${scope}:${create ? "create" : detail}`}
            id={create ? "" : detail}
            onCreated={(id) => {
              setCreate(false);
              select(id);
            }}
          />
        )}
      </Panel>
    </section>
  );
}
function ShiftPanel({
  id,
  onCreated,
}: {
  id: string;
  onCreated: (id: string) => void;
}) {
  const { session, scope } = useApp();
  // Each opened editor reads a fresh version. A cached detail must not seed a
  // draft while its background refresh replaces the displayed record.
  const [editorSession] = useState(() => crypto.randomUUID());
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "shifts", id, editorSession],
    queryFn: ({ signal }) => getShift(id, signal),
    enabled: !!id,
    retry: false,
    gcTime: 0,
  });
  if (id && data.isPending) return <p>근무를 불러오고 있어요.</p>;
  if (id && data.error)
    return <ErrorState error={data.error} retry={() => void data.refetch()} />;
  return (
    <ShiftEditor
      key={id || "create"}
      row={data.data}
      onCreated={onCreated}
      reload={() => void data.refetch()}
    />
  );
}
function ShiftEditor({
  row,
  onCreated,
  reload,
}: {
  row?: Shift;
  onCreated: (id: string) => void;
  reload: () => void;
}) {
  const { session, scope, lookups } = useApp(),
    query = useQueryClient();
  const keys = useIdempotency();
  const branches = lookups.branches.filter((b) => admin(session.user, b.id));
  const [branch, setBranch] = useState(
    row?.branchId || (scope === "all" ? "" : scope),
  );
  const [employee, setEmployee] = useState(row?.employee.id || "");
  const [start, setStart] = useState(
    row ? seoulInput(row.startsAt) : `${businessDate(session.asOf)}T09:00`,
  );
  const [end, setEnd] = useState(
    row ? seoulInput(row.endsAt) : `${businessDate(session.asOf)}T18:00`,
  );
  const [minutes, setMinutes] = useState(row?.plannedBreakMinutes ?? 0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(row?.version);
  const leave = useDraftGuard({
    branch,
    employee,
    start,
    end,
    minutes,
    reason,
  });
  const allowed = row
    ? row.canEdit && admin(session.user, row.branchId) && row.status !== "취소"
    : admin(session.user, branch);
  const stopped =
    lookups.branches.find((b) => b.id === branch)?.status === "운영 중지";
  async function save(cancel = false) {
    setError(null);
    setBusy(true);
    try {
      const times = {
        startsAt: seoulInstant(start),
        endsAt: seoulInstant(end),
        plannedBreakMinutes: minutes,
      };
      const duration =
        (Date.parse(times.endsAt) - Date.parse(times.startsAt)) / 60000;
      if (
        !cancel &&
        (!(duration > 0 && duration <= 1440) ||
          !Number.isInteger(minutes) ||
          minutes < 0 ||
          minutes >= duration)
      )
        throw new Error(
          "근무는 0분 초과 24시간 이하, 예정 휴게는 근무 길이보다 짧게 입력해 주세요.",
        );
      const body = row
        ? {
            version: revision,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(cancel ? {} : times),
          }
        : { branchId: branch, employeeId: employee, ...times };
      const result = await api<Shift>(
        row
          ? `/shifts/${row.id}${cancel ? "/cancel" : ""}`
          : `/shifts?${queryString({ scope })}`,
        {
          method: row && !cancel ? "PATCH" : "POST",
          body,
          ...(row ? {} : { key: keys.key("shift-create", body) }),
        },
      );
      keys.committed();
      leave.saved();
      setRevision(result.version);
      await query.invalidateQueries({ queryKey: ["data"] });
      if (!row) onCreated(result.id);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  const conflicts =
    error instanceof ApiError && error.detail.code === "SHIFT_CONFLICT"
      ? ((error.detail as unknown as { conflicts?: Conflict[] }).conflicts ??
        [])
      : [];
  return (
    <div className="grid gap-4">
      {leave.guard}
      {row && (
        <>
          <p>
            {row.employee.name} · {row.status} · 예정 실근무{" "}
            {row.plannedWorkMinutes}분
          </p>
          <h3>연결된 실제 출퇴근</h3>
          {row.attendance.length ? (
            row.attendance.map((a) => (
              <p key={a.id}>
                {a.status} · {displayDate(a.clockInAt)} ~{" "}
                {a.clockOutAt ? displayDate(a.clockOutAt) : "진행 중"} · 실근무{" "}
                {a.workedMinutes === null
                  ? "퇴근 후 확정"
                  : `${a.workedMinutes}분`}
              </p>
            ))
          ) : (
            <p>실제 출퇴근 기록이 없습니다.</p>
          )}
        </>
      )}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          근무 지점
          <select
            value={branch}
            disabled={!!row || busy}
            required
            onChange={(e) => {
              setBranch(e.target.value);
              setEmployee("");
            }}
          >
            <option value="">지점 선택</option>
            {(row ? lookups.branches : branches).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          근무 직원
          {row ? (
            <input value={row.employee.name} disabled />
          ) : (
            <select
              value={employee}
              disabled={busy}
              required
              onChange={(e) => setEmployee(e.target.value)}
            >
              <option value="">직원 선택</option>
              {lookups.employees
                .filter(
                  (e) =>
                    !e.memberships ||
                    e.memberships.some(
                      (m) =>
                        m.branchId === branch &&
                        (!m.status || m.status === "활성"),
                    ),
                )
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          )}
        </label>
        <label>
          시작 (Asia/Seoul)
          <input
            type="datetime-local"
            value={start}
            required
            disabled={!allowed || busy}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          종료 (Asia/Seoul)
          <input
            type="datetime-local"
            value={end}
            required
            disabled={!allowed || busy}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          예정 휴게 (분)
          <input
            type="number"
            min={0}
            step={1}
            required
            value={minutes}
            disabled={!allowed || busy}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        {row && allowed && (
          <label>
            변경·취소 사유 (선택)
            <textarea
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        {stopped && allowed && (
          <p>운영 중지 지점은 등록·수정할 수 없고 취소만 가능합니다.</p>
        )}
        {error && (
          <div role="alert">
            <p className="form-error">{error.message}</p>
            {conflicts.map((c, i) => (
              <p key={i}>
                {c.visible
                  ? c.label
                  : c.kind === "휴가"
                    ? "승인 휴가"
                    : "다른 지점 근무"}{" "}
                · {displayDate(c.overlapStartsAt)} ~{" "}
                {displayDate(c.overlapEndsAt)}
                {c.visible && c.shift
                  ? ` · ${lookups.branches.find((b) => b.id === c.shift?.branchId)?.name || c.shift.branchId}`
                  : ""}
              </p>
            ))}
            {error instanceof ApiError &&
              error.detail.code === "VERSION_CONFLICT" && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const latest = await getShift(row!.id);
                      setRevision(latest.version);
                      reload();
                      setError(null);
                    } catch (e) {
                      setError(e as Error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  최신 버전 확인 (입력 유지)
                </Button>
              )}
          </div>
        )}
        {allowed && (
          <div className="flex gap-3">
            <Button type="submit" variant="primary" disabled={busy || stopped}>
              {row ? "근무 수정" : "등록하기"}
            </Button>
            {row && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
              >
                근무 취소
              </Button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
