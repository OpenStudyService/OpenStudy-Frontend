import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin, businessDate } from "../../shared/domain/schema";
import type { ResourceMap } from "../../shared/domain/schema";
import { api, MOCK } from "../../shared/api/client";
import { hasBlockingReadError, asPage } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Button } from "../../shared/ui/primitives";
import { shiftDay } from "../../shared/ui/WeekTimeGrid";
import { seoulInput, weekly, weekDays, type Shift, type Weekly } from "./api";

type AttendanceAction = "출근" | "휴게 시작" | "휴게 끝" | "퇴근";
type AttendanceLine = {
  time: string;
  action: AttendanceAction;
  people: Map<string, string>;
};

function attendanceLines(
  records: Weekly["attendance"],
  days: string[],
  employeeLabel: (record: Weekly["attendance"][number]) => string,
) {
  const groups = new Map<string, Map<string, AttendanceLine>>();
  for (const day of days) groups.set(day, new Map());

  for (const record of records) {
    const add = (action: AttendanceAction, instant: string | null) => {
      if (!instant) return;
      const local = seoulInput(instant);
      const day = groups.get(local.slice(0, 10));
      if (!day) return;
      const time = local.slice(11);
      const key = `${time} ${action}`;
      const line = day.get(key) ?? { time, action, people: new Map() };
      line.people.set(
        `${record.branchId}:${record.employee.id}`,
        employeeLabel(record),
      );
      day.set(key, line);
    };

    add("출근", record.clockInAt);
    for (const pause of record.breaks) {
      add("휴게 시작", pause.startedAt);
      add("휴게 끝", pause.endedAt);
    }
    add("퇴근", record.clockOutAt);
  }
  return groups;
}

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];

export function WeekSchedule({ onSelect }: { onSelect: (id: string) => void }) {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
  const today = businessDate(session.asOf);
  const requested = params.get("week");
  const selected = requested && weekDays(requested).length ? requested : today;
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
  const leaves = MOCK
    ? (leave.data?.items.filter(
        (l) =>
          (l.employeeId === session.user.id ||
            admin(session.user, l.branchId)) &&
          l.startsOn <= days[6] &&
          l.endsOn >= days[0],
      ) ?? [])
    : [];
  const branch = (id: string) =>
    lookups.branches.find((b) => b.id === id)?.name || id;
  const employeeLabel = (record: Weekly["attendance"][number] | Shift) =>
    scope === "all"
      ? `${record.employee.name} (${branch(record.branchId)})`
      : record.employee.name;
  const actual = attendanceLines(
    data.data?.attendance ?? [],
    days,
    employeeLabel,
  );
  const planned = data.data?.shifts ?? [];
  function setWeek(date: string) {
    if (!date) return;
    setParams((p) => {
      p.set("week", date);
      return p;
    });
  }
  const week = days[0];
  return (
    <section>
      <div className="week-calendar-toolbar">
        <div className="week-calendar-controls">
          <Button
            aria-label="이전 주"
            onClick={() => setWeek(shiftDay(week, -7))}
          >
            ‹
          </Button>
          <Button onClick={() => setWeek(today)}>이번 주</Button>
          <Button
            aria-label="다음 주"
            onClick={() => setWeek(shiftDay(week, 7))}
          >
            ›
          </Button>
        </div>
        <h2>
          {week.replaceAll("-", ".")} – {days[6].replaceAll("-", ".")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="schedule-week">주간 기준일</label>
          <input
            id="schedule-week"
            type="date"
            value={selected}
            onChange={(event) => setWeek(event.target.value)}
          />
          <small>한국 시간</small>
        </div>
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
      {!data.isPending && !hasBlockingReadError(data) && (
        <div
          className="week-calendar-scroll"
          role="region"
          aria-label="주간 근무 시간표"
          tabIndex={0}
        >
          {!planned.length &&
            !leaves.length &&
            ![...actual.values()].some((day) => day.size) && (
              <p className="px-4 py-3 text-muted">
                등록된 근무와 출퇴근 기록이 없어요.
              </p>
            )}
          <div className="grid min-w-[1120px] grid-cols-7">
            {days.map((day, index) => (
              <div
                className="week-calendar-day-heading"
                key={day}
                aria-current={day === today ? "date" : undefined}
              >
                <h3>
                  <span>{weekdays[index]}</span>
                  <time dateTime={day}>
                    {Number(day.slice(5, 7))}/{Number(day.slice(8))}
                  </time>
                </h3>
              </div>
            ))}
            {days.map((day, index) => {
              const shifts = planned
                .filter((shift) => shift.workDate === day)
                .map((shift) => {
                  const start = seoulInput(shift.startsAt).slice(11);
                  const end = seoulInput(shift.endsAt);
                  const endDay = end.slice(0, 10) === day ? "" : "다음 날 ";
                  return {
                    shift,
                    time: start,
                    range: `${start}–${endDay}${end.slice(11)}`,
                  };
                });
              const lines = [
                ...shifts.map(({ shift, time, range }) => ({
                  time,
                  key: `shift-${shift.id}`,
                  content: (
                    <button
                      type="button"
                      className="w-full rounded-md bg-soft px-2 py-1 text-left hover:underline"
                      aria-label={`예정 근무 · ${employeeLabel(shift)} · ${range}`}
                      onClick={() => onSelect(shift.id)}
                    >
                      <span className="block font-semibold tabular-nums">
                        {range}
                      </span>
                      <span>예정 · {employeeLabel(shift)}</span>
                    </button>
                  ),
                })),
                ...[...(actual.get(day)?.values() ?? [])].map(
                  ({ time, action, people }) => ({
                    time,
                    key: `${time} ${action}`,
                    content: (
                      <p className="break-words px-2 py-1">
                        <span className="whitespace-nowrap">
                          <time
                            className="font-semibold tabular-nums"
                            dateTime={`${day}T${time}+09:00`}
                          >
                            {time}
                          </time>{" "}
                          <span className="text-primary">{action}</span>
                        </span>{" · "}
                        <span>
                          {[...people.values()]
                            .sort((a, b) => a.localeCompare(b, "ko"))
                            .join(", ")}
                        </span>
                      </p>
                    ),
                  }),
                ),
              ].sort((a, b) => a.time.localeCompare(b.time));
              return (
                <section
                  key={day}
                  aria-label={`${day} ${weekdays[index]}요일`}
                  className="min-w-0 border-e border-line p-2 text-xs last:border-e-0"
                >
                  {leaves
                    .filter(
                      (leave) => leave.startsOn <= day && leave.endsOn >= day,
                    )
                    .map((leave) => {
                      const name =
                        lookups.employees.find((e) => e.id === leave.employeeId)
                          ?.name || leave.employeeId;
                      return (
                        <p className="week-calendar-day-note" key={leave.id}>
                          {name} · 휴가 승인 ({leave.amount}일)
                        </p>
                      );
                    })}
                  {lines.length > 0 && (
                    <ul className="m-0 list-none divide-y divide-line p-0">
                      {lines.map(({ key, content }) => (
                        <li key={key}>{content}</li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
