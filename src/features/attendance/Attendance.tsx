import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { Badge, Button, FieldError } from "../../shared/ui/primitives";
import { ResourceGroup } from "../records/ResourcePage";
export function Attendance() {
  return (
    <ResourceGroup
      title="근무·근태"
      description="오늘의 근무부터 휴가와 인수인계까지, 우리 팀의 시간을 함께 관리해요."
      intro={<AttendanceSummary />}
      tabs={[
        { resource: "shifts", label: "근무표" },
        { resource: "attendance", label: "출퇴근·휴게" },
        { resource: "corrections", label: "기록 정정" },
        { resource: "leaveRequests", label: "휴가 신청·승인" },
        { resource: "leaveGrants", label: "휴가 부여", admin: true },
        { resource: "substitutions", label: "대체근무" },
      ]}
    />
  );
}
function AttendanceSummary() {
  const { session, scope, lookups } = useApp(),
    query = useQueryClient(),
    toast = useUi((s) => s.toast),
    [selected, setSelected] = useState(scope === "all" ? "" : scope),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const balances = useQuery({
    queryKey: ["data", session.user.id, scope, "leave-balances"],
    queryFn: () =>
      api<{ employeeId: string; name: string; balance: number }[]>(
        `/leave-balances?scope=${scope}`,
      ),
  });
  const current = lookups.attendance.find(
    (a) => a.employeeId === session.user.id && a.status !== "퇴근",
  );
  async function clock(action: string) {
    setBusy(true);
    setError("");
    try {
      await api(
        current
          ? `/attendance/${current.id}/${action}?scope=${scope}`
          : "/attendance/clockin",
        {
          method: "POST",
          body: current ? { version: current.version } : { branchId: selected },
          key: crypto.randomUUID(),
        },
      );
      await query.invalidateQueries({ queryKey: ["data"] });
      toast("근태 기록을 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2>나의 오늘</h2>
          <Badge>{current?.status || "출근 전"}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!current && (
            <>
              <label className="sr-only" htmlFor="clock-branch">
                출근 지점
              </label>
              <select
                id="clock-branch"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">출근 지점 선택</option>
                {lookups.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={busy || !selected}
                onClick={() => void clock("clockin")}
              >
                출근하기
              </Button>
            </>
          )}
          {current?.status === "근무 중" && (
            <>
              <Button disabled={busy} onClick={() => void clock("break")}>
                휴게 시작
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void clock("clockout")}
              >
                퇴근하기
              </Button>
            </>
          )}
          {current?.status === "휴게 중" && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void clock("resume")}
            >
              휴게 종료
            </Button>
          )}
        </div>
        {error && (
          <div className="mt-3">
            <FieldError>{error}</FieldError>
          </div>
        )}
        <p className="help mt-4">
          예정 근무만으로 출근이 기록되지 않습니다. 기록 수정은 정정 요청을
          이용해 주세요.
        </p>
      </section>
      <section className="card p-5">
        <h2>휴가 잔여량</h2>
        <div className="mt-3 flex flex-wrap gap-4">
          {balances.data?.map((b) => (
            <div key={b.employeeId}>
              <small>{b.name}</small>
              <p className="text-xl font-semibold text-primary">
                {b.balance}
                <small className="ml-1">일</small>
              </p>
            </div>
          ))}
        </div>
        <p className="help mt-3">
          관리자 부여 − 승인 사용 + 승인 취소 복원 · 0.5일 단위
        </p>
      </section>
    </div>
  );
}
