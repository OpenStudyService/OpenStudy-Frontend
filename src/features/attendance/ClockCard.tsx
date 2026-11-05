import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { businessDate } from "../../shared/domain/schema";
import { Badge, Button } from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { attendanceApi, workedTime } from "./attendance-api";
import { shiftTime } from "./api";

export function ClockCard() {
  const { session, scope, lookups } = useApp(),
    query = useQueryClient(),
    keys = useIdempotency();
  const [selected, setSelected] = useState(scope === "all" ? "" : scope);
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  const [error, setError] = useState("");
  // Current work is global to the employee and survives a branch scope change.
  const current = useQuery({
    queryKey: ["data", session.user.id, "me", "attendance-current"],
    queryFn: ({ signal }) => attendanceApi.current(signal),
    retry: false,
    refetchInterval: 30000,
  });
  const record = current.data?.attendance;
  const latest = useQuery({
    queryKey: ["data", session.user.id, "me", "attendance-latest"],
    queryFn: ({ signal }) =>
      attendanceApi.list({ scope: "all", mine: "true", pageSize: 1 }, signal),
    enabled: current.isSuccess && record === null,
    retry: false,
  });
  const member = (id: string) =>
    session.user.memberships.some(
      (m) => m.branchId === id && (!m.status || m.status === "활성"),
    );
  const branches = lookups.branches.filter(
    (b) => member(b.id) && b.status === "운영 중",
  );
  const ready =
    current.isSuccess && !current.isFetching && !current.error && !busy;
  const last = latest.data?.items[0];
  const status =
    record?.status ||
    (last?.clockOutAt &&
    current.data &&
    businessDate(last.clockOutAt) === businessDate(current.data.asOf)
      ? "퇴근"
      : "근무 전");
  async function clock(
    action: "clock-in" | "break-start" | "break-end" | "clock-out",
  ) {
    if (!ready || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "clock-in")
        await attendanceApi.clockIn(
          selected,
          keys.key("attendance-clock-in", { branchId: selected }),
        );
      else if (record) await attendanceApi.command(action, record.version);
      keys.committed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // A command or replay response is never used as current state. Even a lost
      // response may have committed; always reconcile against the server.
      await query.invalidateQueries({ queryKey: ["data", session.user.id] });
      const result = await current.refetch();
      if (result.error)
        setError(
          (previous) =>
            previous ||
            "요청 후 현재 상태를 확인하지 못했습니다. 다시 불러와 주세요.",
        );
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card mb-5 p-5" aria-label="본인 출퇴근">
      <div className="mb-3 flex items-center justify-between">
        <h2>나의 출퇴근</h2>
        <Badge>
          {current.error
            ? "상태 확인 필요"
            : current.isPending
              ? "확인 중"
              : status}
        </Badge>
      </div>
      <DataNotice
        label="본인 현재 근태"
        loading={current.isPending}
        error={current.error}
        retry={() => void current.refetch()}
      />
      {record && !current.error && (
        <p>
          {lookups.branches.find((b) => b.id === record.branchId)?.name ||
            record.branchId}{" "}
          · 출근 {shiftTime(record.clockInAt)} ·{" "}
          {record.shiftId ? "예정 근무 연결" : "연결된 예정 근무 없음"} · 실근무{" "}
          {workedTime(record.workedMinutes)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {current.isSuccess && !record && (
          <>
            <label htmlFor="clock-branch">출근 지점</label>
            <select
              id="clock-branch"
              value={selected}
              disabled={!ready}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">지점 선택</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              disabled={!ready || !branches.some((b) => b.id === selected)}
              onClick={() => void clock("clock-in")}
            >
              출근하기
            </Button>
          </>
        )}
        {record?.status === "근무 중" && (
          <>
            <Button
              disabled={!ready || !member(record.branchId)}
              onClick={() => void clock("break-start")}
            >
              휴게 시작
            </Button>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => void clock("clock-out")}
            >
              퇴근하기
            </Button>
          </>
        )}
        {record?.status === "휴게 중" && (
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => void clock("break-end")}
          >
            휴게 종료
          </Button>
        )}
        <Button
          disabled={busy || current.isFetching}
          onClick={() => void current.refetch()}
        >
          현재 상태 새로고침
        </Button>
      </div>
      {current.isSuccess && !record && branches.length === 0 && (
        <p className="help">출근 가능한 활성 소속 지점이 없습니다.</p>
      )}
      {error && (
        <p className="form-error mt-3" role="alert">
          {error}
        </p>
      )}
      <p className="help mt-3">
        시각은 서버에서 기록합니다. 예정 근무만으로 출근 처리되지 않으며, 실근무
        분은 퇴근 후 확정됩니다.
      </p>
    </section>
  );
}
