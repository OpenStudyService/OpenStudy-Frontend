import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { admin, businessDate } from "../../shared/domain/schema";
import type { ResourceMap } from "../../shared/domain/schema";
import { api, MOCK } from "../../shared/api/client";
import { hasBlockingReadError, asPage } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Button } from "../../shared/ui/primitives";
import {
  shiftDay,
  WeekTimeGrid,
  type WeekEvent,
} from "../../shared/ui/WeekTimeGrid";
import { weekly, weekDays } from "./api";

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
  const events: WeekEvent[] = [
    ...(data.data?.shifts ?? []).map((shift) => {
      const detail = `예정 근무 · ${branch(shift.branchId)}`;
      const summary = `예정 휴게 ${shift.plannedBreakMinutes}분 · 실근무 ${shift.plannedWorkMinutes}분`;
      return {
        id: `shift-${shift.id}`,
        startAt: shift.startsAt,
        endAt: shift.endsAt,
        title: shift.employee.name,
        detail,
        summary,
        label: `${detail} · ${shift.employee.name} · ${summary}`,
        status: "planned-work",
        onSelect: () => onSelect(shift.id),
      };
    }),
    ...(data.data?.attendance ?? []).map((record) => {
      const detail = `실제 출퇴근 · ${branch(record.branchId)}`;
      const summary = record.clockOutAt
        ? `실근무 ${record.workedMinutes ?? "미확정"}분`
        : "진행 중 · 퇴근 후 실근무 확정";
      const markerEnd =
        Date.parse(session.asOf) > Date.parse(record.clockInAt)
          ? session.asOf
          : record.clockInAt;
      return {
        id: `attendance-${record.id}`,
        startAt: record.clockInAt,
        endAt: record.clockOutAt ?? markerEnd,
        title: record.employee.name,
        detail,
        summary,
        label: `${detail} · ${record.employee.name} · ${summary}`,
        status: record.clockOutAt ? "actual-work" : "working",
        ongoing: !record.clockOutAt,
      };
    }),
  ];
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
        <WeekTimeGrid
          week={week}
          today={today}
          events={events}
          label="주간 근무 시간표"
          emptyMessage="등록된 근무와 출퇴근 기록이 없어요."
          getDayNotes={(date) =>
            leaves
              .filter((l) => l.startsOn <= date && l.endsOn >= date)
              .map((l) => {
                const name =
                  lookups.employees.find((e) => e.id === l.employeeId)?.name ||
                  l.employeeId;
                return `${name} · 휴가 승인 (${l.amount}일)`;
              })
          }
        />
      )}
    </section>
  );
}
