import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { businessDate, can, overlap } from "../shared/domain/schema";
import { facilityView, inquiryView, noticeView } from "./collaboration";
import { seatCounts, seatView } from "./seats";
import { assert, store } from "./store";
import { taskView } from "./tasks";
import { shiftVisible } from "./workforce";

type S = components["schemas"];
type Filters = Record<string, string>;
const source = (
  operationId: string,
  query: Filters,
  clientFilter: string | null = null,
): S["HomeSource"] => ({ operationId, query, clientFilter });

function ratio(numerator: number, denominator: number): S["Ratio"] {
  return {
    numerator,
    denominator,
    state: denominator ? "value" : "notApplicable",
    percent: denominator
      ? Math.round((numerator / denominator) * 1000) / 10
      : null,
  };
}

export function homeSummary(request: Request): S["HomeSummary"] {
  const user = store.activeUser();
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") || "all";
  const branchIds = store.db.branches
    .filter(
      (branch) =>
        (scope === "all" || scope === branch.id) && can(user, branch.id),
    )
    .map((branch) => branch.id)
    .sort();
  assert(
    scope === "all" || branchIds.includes(scope),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );

  const explicitMine = z
    .enum(["true", "false"])
    .nullable()
    .parse(params.get("mine"));
  const assigneeId = z
    .string()
    .min(1)
    .nullable()
    .parse(params.get("assigneeId"));
  assert(
    explicitMine !== "true" || !assigneeId,
    "본인 업무와 담당자를 함께 선택할 수 없습니다.",
    422,
    "VALIDATION_FAILED",
  );
  const defaulted = explicitMine === null && assigneeId === null;
  const mine = defaulted ? !user.owner : explicitMine === "true";
  const filter: Filters = assigneeId ? { assigneeId } : { mine: String(mine) };
  const asOf = store.now();
  const date = businessDate(asOf);
  const dayStart = new Date(`${date}T00:00:00+09:00`).toISOString();
  const dayEnd = new Date(Date.parse(dayStart) + 86400000).toISOString();
  const yesterday = businessDate(
    new Date(Date.parse(dayStart) - 1).toISOString(),
  );
  const listBranch = scope === "all" ? null : scope;
  const link = (
    screen: S["HomeLink"]["screen"],
    query: Filters = {},
    branchId = listBranch,
    targetId: string | null = null,
  ): S["HomeLink"] => ({ screen, query, branchId, targetId });
  const scoped = <T extends { branchId: string }>(rows: T[]) =>
    rows.filter((row) => branchIds.includes(row.branchId));

  const seats = scoped(store.db.seats).map(seatView);
  const { total, inUse, available, blocked } = seatCounts(scope, seats, asOf);
  const tasks = scoped(store.db.tasks).map((row) => taskView(user, row, asOf));
  const summarizeTasks = (assignee: string | null) => {
    const selected = tasks.filter(
      (task) => !assignee || task.assignee.id === assignee,
    );
    const open = selected.flatMap((task) =>
      task.status !== "완료" && task.dueAt && task.dueAt < dayEnd
        ? [{ ...task, dueAt: task.dueAt }]
        : [],
    );
    const completedToday = selected.filter(
      (task) =>
        task.status === "완료" &&
        task.completedAt &&
        task.completedAt >= dayStart &&
        task.completedAt < dayEnd,
    ).length;
    const total = open.length + completedToday;
    return {
      open,
      counts: {
        total,
        open: open.length,
        completedToday,
        overdue: open.filter((task) => task.overdue).length,
        completionRate: ratio(completedToday, total),
      },
    };
  };
  const personalTasks = summarizeTasks(user.id);
  const today = mine ? personalTasks : summarizeTasks(assigneeId);
  const inquiries = scoped(store.db.inquiries)
    .map((row) => inquiryView(row, user))
    .filter((row) => row.status !== "답변 완료")
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  const facilities = scoped(store.db.facilities)
    .map((row) => facilityView(row, user))
    .flatMap((row) =>
      row.inspectionDue && row.nextInspectionOn
        ? [{ ...row, nextInspectionOn: row.nextInspectionOn }]
        : [],
    )
    .sort(
      (a, b) =>
        a.nextInspectionOn.localeCompare(b.nextInspectionOn) ||
        a.id.localeCompare(b.id),
    );
  const shifts = scoped(store.db.shifts)
    .filter(
      (shift) =>
        shift.status !== "취소" &&
        overlap(shift.startsAt, shift.endsAt, dayStart, dayEnd),
    )
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  const visibleShifts = shifts.filter((shift) =>
    shiftVisible(shift, user, scope),
  );
  const colleagues = shifts
    .flatMap(({ branchId, employeeId, startsAt, endsAt }) => {
      const employee = store.db.employees.find(
        (person) => person.id === employeeId,
      );
      const memberOf = (person: typeof user) =>
        person.memberships.some(
          (membership) =>
            membership.branchId === branchId &&
            (!membership.status || membership.status === "활성"),
        );
      return employeeId !== user.id &&
        employee?.status === "활성" &&
        memberOf(user) &&
        memberOf(employee)
        ? [{ branchId, startsAt, endsAt, employeeName: employee.name }]
        : [];
    })
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        a.endsAt.localeCompare(b.endsAt) ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.branchId.localeCompare(b.branchId),
    );
  const notices = store.db.notices
    .map((row) => noticeView(row, user))
    .flatMap((row) =>
      row.status === "게시 중" &&
      row.publishedAt &&
      (row.target === "전체" ||
        row.branchIds.some((id) => branchIds.includes(id)))
        ? [{ ...row, publishedAt: row.publishedAt }]
        : [],
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        b.id.localeCompare(a.id),
    );
  const taskSource = { scope, ...filter, dueTo: dayEnd };
  return {
    meta: {
      branchIds,
      allBranches: scope === "all",
      date,
      dayStart,
      dayEnd,
      asOf,
      timeZone: "Asia/Seoul",
      taskFilter: { mine, assigneeId, defaulted },
    },
    seats: {
      total,
      inUse,
      available,
      blocked,
      occupancy: ratio(inUse, total),
      branches: branchIds.map((branchId) => {
        const counts = seatCounts(
          branchId,
          seats.filter((seat) => seat.branchId === branchId),
          asOf,
        );
        return {
          branchId,
          total: counts.total,
          inUse: counts.inUse,
          occupancy: ratio(counts.inUse, counts.total),
        };
      }),
      link: link("seat-board"),
      source: source("getSeatOccupancy", { scope }),
    },
    tasks: {
      today: today.counts,
      mine: personalTasks.counts,
      items: today.open
        .sort(
          (a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id),
        )
        .slice(0, 5)
        .map(
          ({
            id,
            branchId,
            title,
            status,
            priority,
            dueAt,
            assignee,
            overdue,
          }) => ({
            id,
            branchId,
            title,
            status,
            priority,
            dueAt,
            assignee,
            overdue,
            link: link("task-detail", {}, branchId, id),
          }),
        ),
      link: link("task-list", filter),
      sources: [
        source("listTasks", { ...taskSource, status: "할 일" }),
        source("listTasks", { ...taskSource, status: "진행 중" }),
        source("getTaskSummary", taskSource),
        source(
          "listTasks",
          { scope, ...filter, status: "완료" },
          `completedAt ∈ [${dayStart}, ${dayEnd})`,
        ),
      ],
    },
    inquiries: {
      unresolved: inquiries.length,
      received: inquiries.filter((row) => row.status === "접수").length,
      inProgress: inquiries.filter((row) => row.status === "처리 중").length,
      items: inquiries
        .slice(0, 5)
        .map(({ id, branchId, subject, status, createdAt }) => ({
          id,
          branchId,
          subject,
          status,
          createdAt,
          link: link("inquiry-detail", {}, branchId, id),
        })),
      link: link("inquiry-list"),
      source: source("getInquirySummary", { scope }),
    },
    facilities: {
      inspectionDue: facilities.length,
      items: facilities
        .slice(0, 5)
        .map(({ id, branchId, name, status, nextInspectionOn }) => ({
          id,
          branchId,
          name,
          status,
          nextInspectionOn,
          link: link("facility-detail", {}, branchId, id),
        })),
      link: link("facility-list", { inspectionDue: "true" }),
      source: source("getFacilitySummary", { scope }),
    },
    shifts: {
      count: visibleShifts.length,
      colleagueCount: colleagues.length,
      colleagues: colleagues.slice(0, 5),
      items: visibleShifts
        .slice(0, 5)
        .map(({ id, branchId, employeeId, startsAt, endsAt }) => ({
          id,
          branchId,
          startsAt,
          endsAt,
          employee: {
            id: employeeId,
            name:
              store.db.employees.find((person) => person.id === employeeId)
                ?.name ?? employeeId,
          },
          link: link("shift-detail", {}, branchId, id),
        })),
      link: link("shift-list", { from: date, to: date }),
      source: source(
        "listShifts",
        { scope, status: "예정", from: yesterday, to: date },
        `startsAt < ${dayEnd} ∧ endsAt > ${dayStart}`,
      ),
    },
    notices: {
      items: notices.slice(0, 5).map(({ id, title, pinned, publishedAt }) => ({
        id,
        title,
        pinned,
        publishedAt,
        link: link("notice-detail", {}, null, id),
      })),
      link: link("notice-list", { status: "게시 중" }, null),
      source: source("listNotices", {
        scope,
        status: "게시 중",
        page: "1",
        pageSize: "5",
      }),
    },
  };
}
