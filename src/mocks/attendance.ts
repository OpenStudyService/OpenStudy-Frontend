/** M8 contract adapter for the mock ledger, excluded from live bundles. */
import { http, HttpResponse } from "msw/http";
import { delay } from "msw";
import { z } from "zod";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { admin, businessDate, can } from "../shared/domain/schema";
import type { AttendanceRecord } from "../features/attendance/attendance-api";
import { assert, DomainError, store } from "./store";
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const now = () =>
  new Date(Math.floor(Date.parse(store.now()) / 1000) * 1000).toISOString();
const member = (u: Employee, branchId: string) =>
  u.memberships.some(
    (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
  );
export function attendanceRecord(
  row: ResourceMap["attendance"],
): AttendanceRecord {
  const seconds = row.endedAt
    ? (Date.parse(row.endedAt) -
        Date.parse(row.startedAt) -
        row.breaks.reduce(
          (sum, b) =>
            sum + (b.end ? Date.parse(b.end) - Date.parse(b.start) : 0),
          0,
        )) /
      1000
    : null;
  return {
    id: row.id,
    version: row.version,
    branchId: row.branchId,
    employee: {
      id: row.employeeId,
      name:
        store.db.employees.find((e) => e.id === row.employeeId)?.name ||
        row.employeeId,
    },
    shiftId: row.canonical?.shiftId ?? null,
    clockInAt: row.startedAt,
    clockOutAt: row.endedAt || null,
    workDate: businessDate(row.startedAt),
    status: row.status,
    workedMinutes:
      seconds === null ? null : Math.max(0, Math.floor(seconds / 60)),
    breaks: row.breaks.map((b, i) => ({
      id: String(i),
      startedAt: b.start,
      endedAt: b.end || null,
    })),
  };
}
function visible(row: ResourceMap["attendance"], u: Employee, scope = "all") {
  return (
    (scope === "all" || row.branchId === scope) &&
    can(u, row.branchId) &&
    (admin(u, row.branchId) || row.employeeId === u.id)
  );
}
const route =
  (fn: (a: Args, u: Employee) => unknown | Promise<unknown>, status = 200) =>
  async (a: Args) => {
    try {
      const u = store.activeUser();
      if (store.scenario === "slow") await delay(2200);
      assert(
        store.scenario !== "error",
        "서버를 확인해 주세요.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "인증을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json((await fn(a, u)) as Record<string, unknown>, {
        status,
      });
    } catch (e) {
      if (e instanceof z.ZodError)
        return HttpResponse.json(
          { code: "VALIDATION_FAILED", message: "입력을 확인해 주세요." },
          { status: 422 },
        );
      if (e instanceof DomainError)
        return HttpResponse.json(
          {
            code: e.code,
            message: e.message,
            latestVersion: e.latestVersion,
            reloadUrl: "/api/me/attendance/current",
          },
          { status: e.status },
        );
      throw e;
    }
  };
function current(u: Employee) {
  return store.db.attendance.find(
    (r) => r.employeeId === u.id && r.status !== "퇴근",
  );
}
export const attendanceHandlers = [
  http.get(
    "/api/me/attendance/current",
    route((_a, u) => {
      const row = current(u);
      return { attendance: row ? attendanceRecord(row) : null, asOf: now() };
    }),
  ),
  http.post(
    "/api/me/attendance/clock-in",
    route(async (a, u) => {
      const body = z
          .object({ branchId: z.string().min(1) })
          .strict()
          .parse(await a.request.json()),
        key = a.request.headers.get("Idempotency-Key");
      assert(key, "요청 키가 필요합니다.", 422, "VALIDATION_FAILED");
      return store.transaction(
        key,
        { operation: "attendance:clock-in", body },
        () => {
          assert(
            member(u, body.branchId),
            "활성 소속 지점이 아닙니다.",
            403,
            "FORBIDDEN",
          );
          assert(
            store.db.branches.find((b) => b.id === body.branchId)?.status ===
              "운영 중",
            "운영 중지 지점입니다.",
            409,
            "BRANCH_NOT_ACTIVE",
          );
          assert(
            !current(u),
            "이미 진행 중인 근태가 있습니다.",
            409,
            "ATTENDANCE_ALREADY_WORKING",
          );
          const at = now(),
            shift = store.db.shifts.find(
              (s) =>
                s.employeeId === u.id &&
                s.branchId === body.branchId &&
                s.status !== "취소" &&
                Date.parse(s.startsAt) <= Date.parse(at) &&
                Date.parse(at) < Date.parse(s.endsAt),
            );
          const row = store.add("attendance", body.branchId, {
            employeeId: u.id,
            startedAt: at,
            endedAt: "",
            breaks: [],
            workedMinutes: 0,
            status: "근무 중",
          });
          row.canonical = {
            ...attendanceRecord(row),
            shiftId: shift?.id ?? null,
          };
          store.emit("attendance-records", row.id, row.branchId);
          return row.canonical;
        },
      );
    }, 201),
  ),
  ...(["break-start", "break-end", "clock-out"] as const).map((action) =>
    http.post(
      `/api/me/attendance/${action}`,
      route(async (a, u) => {
        const body = z
            .object({ version: z.number().int().nonnegative() })
            .strict()
            .parse(await a.request.json()),
          row = current(u);
        assert(
          row,
          "진행 중인 근태가 없습니다.",
          409,
          "ATTENDANCE_NOT_WORKING",
        );
        if (action === "break-end")
          assert(
            row.status === "휴게 중",
            "휴게 중이 아닙니다.",
            409,
            "ATTENDANCE_NOT_ON_BREAK",
          );
        else
          assert(
            row.status === "근무 중",
            "휴게를 먼저 종료해 주세요.",
            409,
            "ATTENDANCE_ON_BREAK",
          );
        assert(
          body.version === row.version,
          "최신 상태를 확인해 주세요.",
          409,
          "VERSION_CONFLICT",
        );
        if (action === "break-start")
          assert(
            member(u, row.branchId),
            "활성 소속 지점이 아닙니다.",
            403,
            "FORBIDDEN",
          );
        const at = now();
        if (action === "break-start") {
          row.breaks.push({ start: at, end: "" });
          row.status = "휴게 중";
        }
        if (action === "break-end") {
          row.breaks.find((b) => !b.end)!.end = at;
          row.status = "근무 중";
        }
        if (action === "clock-out") {
          row.endedAt = at;
          row.status = "퇴근";
        }
        row.version++;
        row.updatedAt = at;
        const result = attendanceRecord(row);
        row.workedMinutes = result.workedMinutes ?? 0;
        store.persist();
        store.emit("attendance-records", row.id, row.branchId);
        return result;
      }),
    ),
  ),
  http.get(
    "/api/attendance-records",
    route((a, u) => {
      const p = new URL(a.request.url).searchParams,
        scope = p.get("scope") || "all",
        page = Number(p.get("page") || 1),
        size = Number(p.get("pageSize") || 20);
      assert(can(u, scope), "접근할 수 없는 지점입니다.", 403, "FORBIDDEN");
      assert(
        Number.isInteger(page) &&
          page > 0 &&
          Number.isInteger(size) &&
          size > 0 &&
          size <= 100,
        "페이지를 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      if (p.get("from") && p.get("to"))
        assert(
          p.get("from")! <= p.get("to")!,
          "날짜 범위를 확인해 주세요.",
          422,
          "VALIDATION_FAILED",
        );
      const rows = store.db.attendance
        .filter((r) => visible(r, u, scope))
        .map(attendanceRecord)
        .filter(
          (r) =>
            (p.get("mine") !== "true" || r.employee.id === u.id) &&
            (!p.get("employeeId") || r.employee.id === p.get("employeeId")) &&
            (!p.get("shiftId") || r.shiftId === p.get("shiftId")) &&
            (!p.get("status") || r.status === p.get("status")) &&
            (!p.get("from") || r.workDate >= p.get("from")!) &&
            (!p.get("to") || r.workDate <= p.get("to")!),
        )
        .sort(
          (a, b) =>
            b.clockInAt.localeCompare(a.clockInAt) || b.id.localeCompare(a.id),
        );
      return {
        items: rows.slice((page - 1) * size, page * size),
        meta: { page, pageSize: size, total: rows.length },
      };
    }),
  ),
  http.get(
    "/api/attendance-records/:id",
    route((a, u) => {
      const row = store.get("attendance", String(a.params.id));
      assert(visible(row, u), "근태를 찾을 수 없습니다.", 404, "NOT_FOUND");
      return attendanceRecord(row);
    }),
  ),
];
