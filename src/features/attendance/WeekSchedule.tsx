import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api } from "../../shared/api/client";
import { businessDate, displayDate } from "../../shared/domain/schema";
import type { Page, ResourceMap } from "../../shared/domain/schema";
import { Badge, ErrorState, State } from "../../shared/ui/primitives";

export function WeekSchedule({ onSelect }: { onSelect: (id: string) => void }) {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
  const selected = params.get("week") || businessDate(session.asOf);
  const date = new Date(`${selected}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(date.getTime() + i * 86400000).toISOString().slice(0, 10),
  );
  const shifts = useQuery({
    queryKey: ["data", session.user.id, scope, "shifts", "week", days[0]],
    queryFn: ({ signal }) =>
      api<Page<ResourceMap["shifts"]>>(
        `/shifts?scope=${scope}&pageSize=100&from=${days[0]}&to=${days[6]}`,
        { signal },
      ),
  });
  const leave = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "leaveRequests",
      "week",
      days[0],
    ],
    queryFn: ({ signal }) =>
      api<Page<ResourceMap["leaveRequests"]>>(
        `/leaveRequests?scope=${scope}&pageSize=100&status=승인&from=${days[0]}&to=${days[6]}`,
        { signal },
      ),
  });
  const people = lookups.employees.filter(
    (e) =>
      !e.owner &&
      e.memberships.some((m) => scope === "all" || m.branchId === scope),
  );
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
          {days[0]} ~ {days[6]} · 휴가는 승인 기록 기준
        </small>
      </div>
      {shifts.isPending ? (
        <State loading />
      ) : shifts.error ? (
        <ErrorState error={shifts.error} />
      ) : (
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
              {people.map((person) => (
                <tr key={person.id}>
                  <th scope="row">{person.name}</th>
                  {days.map((d) => (
                    <td key={d} className="align-top">
                      <div className="flex min-h-20 flex-col gap-2">
                        {shifts.data?.items
                          .filter(
                            (s) =>
                              s.employeeId === person.id &&
                              businessDate(s.startsAt) <= d &&
                              businessDate(s.endsAt) >= d &&
                              s.status !== "취소",
                          )
                          .map((s) => (
                            <button
                              className="calendar-item text-left"
                              key={s.id}
                              onClick={() => onSelect(s.id)}
                            >
                              {
                                lookups.branches.find(
                                  (b) => b.id === s.branchId,
                                )?.name
                              }
                              <br />
                              {displayDate(s.startsAt).slice(-5)} ~{" "}
                              {displayDate(s.endsAt).slice(-5)}
                              <br />
                              <small>
                                휴게 {s.breakMinutes}분 · {s.status}
                              </small>
                            </button>
                          ))}
                        {leave.data?.items
                          .filter(
                            (l) =>
                              l.employeeId === person.id &&
                              l.startsOn <= d &&
                              l.endsOn >= d,
                          )
                          .map((l) => (
                            <Badge key={l.id}>휴가 · {l.amount}일 승인</Badge>
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
      {leave.error && <ErrorState error={leave.error} />}
    </section>
  );
}
