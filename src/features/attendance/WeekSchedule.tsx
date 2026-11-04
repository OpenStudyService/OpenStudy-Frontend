import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin, businessDate } from "../../shared/domain/schema";
import type { ResourceMap } from "../../shared/domain/schema";
import { api, MOCK } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
import { weekly, weekDays, shiftTime as displayDate } from "./api";

export function WeekSchedule({ onSelect }: { onSelect: (id: string) => void }) {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
  const selected = params.get("week") || businessDate(session.asOf);
  const days = weekDays(selected);
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "shifts", "weekly", selected],
    queryFn: ({ signal }) => weekly(scope, selected, signal),
    retry: false,
  });
  // Preserve the existing demo's M12 leave overlay only in the mock build.
  const leave = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "leaveRequests",
      "week",
      days[0],
    ],
    queryFn: async ({ signal }) =>
      asPage<ResourceMap["leaveRequests"]>(
        await api(
          `/leaveRequests?scope=${scope}&pageSize=100&status=승인&from=${days[0]}&to=${days[6]}`,
          { signal },
        ),
      ),
    enabled: MOCK,
    retry: false,
  });
  // Rows come only from the authorized response, never the staff lookup.
  const people = new Map(
    [...(data.data?.shifts ?? []), ...(data.data?.attendance ?? [])].map(
      (r) => [r.employee.id, r.employee.name],
    ),
  );
  const leaves = MOCK
    ? (leave.data?.items.filter(
        (l) =>
          (l.employeeId === session.user.id ||
            admin(session.user, l.branchId)) &&
          l.startsOn <= days[6] &&
          l.endsOn >= days[0],
      ) ?? [])
    : [];
  for (const l of leaves)
    people.set(
      l.employeeId,
      lookups.employees.find((e) => e.id === l.employeeId)?.name ||
        l.employeeId,
    );
  const branch = (id: string) =>
    lookups.branches.find((b) => b.id === id)?.name || id;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <label htmlFor="schedule-week">주간 기준일</label>
        <input
          id="schedule-week"
          type="date"
          value={selected}
          onChange={(e) => {
            if (e.target.value)
              setParams((p) => {
                p.set("week", e.target.value);
                return p;
              });
          }}
        />
        <small>
          {days[0]} ~ {days[6]} · Asia/Seoul · 시작한 날짜 기준
        </small>
      </div>
      <DataNotice
        label="근무표 데이터"
        loading={data.isPending}
        error={data.error}
        retry={() => void data.refetch()}
      />
      {MOCK && (
        <DataNotice
          label="휴가 일정"
          error={leave.error}
          retry={() => void leave.refetch()}
        />
      )}
      {!data.error && (
        <div className="data-scroll">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th>직원</th>
                {days.map((d, i) => (
                  <th key={d}>
                    {d.slice(5)} {"월화수목금토일"[i]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!people.size && !data.isPending && (
                <tr>
                  <td colSpan={8}>등록된 근무와 출퇴근 기록이 없어요.</td>
                </tr>
              )}
              {[...people].map(([id, name]) => (
                <tr key={id}>
                  <th scope="row">{name}</th>
                  {days.map((d) => (
                    <td key={d} className="align-top">
                      <div className="flex min-h-20 flex-col gap-2">
                        {data.data?.shifts
                          .filter(
                            (s) => s.employee.id === id && s.workDate === d,
                          )
                          .map((s) => (
                            <button
                              className="calendar-item text-left"
                              key={s.id}
                              onClick={() => onSelect(s.id)}
                            >
                              예정 근무 · {branch(s.branchId)}
                              <br />
                              {displayDate(s.startsAt)} ~{" "}
                              {displayDate(s.endsAt)}
                              <br />
                              <small>
                                예정 휴게 {s.plannedBreakMinutes}분 · 예정
                                실근무 {s.plannedWorkMinutes}분
                              </small>
                            </button>
                          ))}
                        {data.data?.attendance
                          .filter(
                            (a) => a.employee.id === id && a.workDate === d,
                          )
                          .map((a) => (
                            <div className="card p-2" key={a.id}>
                              실제 출퇴근 · {branch(a.branchId)} · {a.status}
                              <br />
                              {displayDate(a.clockInAt)} ~{" "}
                              {a.clockOutAt
                                ? displayDate(a.clockOutAt)
                                : "진행 중"}
                              <br />
                              실근무{" "}
                              {a.workedMinutes === null
                                ? "퇴근 후 확정"
                                : `${a.workedMinutes}분`}
                            </div>
                          ))}
                        {leaves
                          .filter(
                            (l) =>
                              l.employeeId === id &&
                              l.startsOn <= d &&
                              l.endsOn >= d,
                          )
                          .map((l) => (
                            <span className="badge" key={l.id}>
                              휴가 · {l.amount}일 승인
                            </span>
                          ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
