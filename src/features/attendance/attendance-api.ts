import { z } from "zod";
import type { components } from "../../shared/api/foundation.generated";
import { api, ApiError, queryString } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
export type AttendanceRecord = components["schemas"]["AttendanceRecord"];
const instant = z.string().datetime({ offset: true });
const record = z.object({
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
  status: z.enum(["근무 중", "휴게 중", "퇴근"]),
  branchId: z.string().min(1),
  employee: z.object({ id: z.string().min(1), name: z.string() }),
  shiftId: z.string().nullable(),
  clockInAt: instant,
  clockOutAt: instant.nullable(),
  workDate: z.string(),
  breaks: z.array(
    z.object({
      id: z.string(),
      startedAt: instant,
      endedAt: instant.nullable(),
    }),
  ),
  workedMinutes: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<AttendanceRecord>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "근태 응답을 확인할 수 없습니다. 다시 불러와 주세요.",
    });
  return result.data;
}
const current = z.object({ attendance: record.nullable(), asOf: instant });
const page = z.object({
  items: z.array(record),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type AttendanceFilters = {
  scope: string;
  page?: number;
  pageSize?: number;
  mine?: string;
  employeeId?: string;
  from?: string;
  to?: string;
  status?: string;
  shiftId?: string;
};
export const attendanceApi = {
  current: async (signal?: AbortSignal) =>
    parse(current, await api("/me/attendance/current", { signal })),
  list: async (filters: AttendanceFilters, signal?: AbortSignal) =>
    asPage<AttendanceRecord>(
      parse(
        page,
        await api(`/attendance-records?${queryString(filters)}`, { signal }),
      ),
    ),
  get: async (id: string, signal?: AbortSignal) =>
    parse(
      record,
      await api(`/attendance-records/${encodeURIComponent(id)}`, { signal }),
    ),
  clockIn: async (branchId: string, key: string) =>
    parse(
      record,
      await api("/me/attendance/clock-in", {
        method: "POST",
        body: { branchId },
        key,
      }),
    ),
  command: async (
    action: "break-start" | "break-end" | "clock-out",
    version: number,
  ) =>
    parse(
      record,
      await api(`/me/attendance/${action}`, {
        method: "POST",
        body: { version },
      }),
    ),
};
export const workedTime = (minutes: number | null) =>
  minutes === null ? "퇴근 후 확정" : `${minutes}분`;
