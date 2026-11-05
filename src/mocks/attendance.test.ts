import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";
import { store } from "./store";
import { attendanceHandlers } from "./attendance";
import { workforceHandlers } from "./workforce";
import { api, clearCsrf } from "../shared/api/client";
import { attendanceApi } from "../features/attendance/attendance-api";
import { getShift, weekly, type Shift } from "../features/attendance/api";
const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "openstudy-mock-csrf" }),
  ),
  ...attendanceHandlers,
  ...workforceHandlers,
);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "junho";
  store.db.attendance = [];
  store.db.shifts = [];
  store.db.leaveRequests = [];
});
afterEach(() => {
  clearCsrf();
  server.resetHandlers();
});
it("links a real mock shift and preserves it through clock/break/out with one minutes source", async () => {
  store.persona = "owner";
  const start = new Date(
      Math.floor((Date.parse(store.now()) - 3600000) / 60000) * 60000,
    ).toISOString(),
    end = new Date(Date.parse(start) + 8 * 3600000).toISOString();
  const shift = await api<Shift>("/shifts", {
    method: "POST",
    key: "plan",
    body: {
      branchId: "gangnam",
      employeeId: "junho",
      startsAt: start,
      endsAt: end,
      plannedBreakMinutes: 30,
    },
  });
  store.persona = "junho";
  const clocked = await attendanceApi.clockIn("gangnam", "in");
  expect(clocked.shiftId).toBe(shift.id);
  expect((await attendanceApi.clockIn("gangnam", "in")).id).toBe(clocked.id);
  await expect(
    attendanceApi.clockIn("gangnam", "duplicate"),
  ).rejects.toMatchObject({ status: 409 });
  const pause = await attendanceApi.command("break-start", clocked.version);
  expect(pause.status).toBe("휴게 중");
  await expect(
    attendanceApi.command("clock-out", pause.version),
  ).rejects.toMatchObject({ detail: { code: "ATTENDANCE_ON_BREAK" } });
  const resume = await attendanceApi.command("break-end", pause.version);
  const left = await attendanceApi.command("clock-out", resume.version);
  expect(left.workedMinutes).toBe(0);
  expect((await attendanceApi.current()).attendance).toBeNull();
  expect((await attendanceApi.get(left.id)).workedMinutes).toBe(
    left.workedMinutes,
  );
  expect(
    (await attendanceApi.list({ scope: "gangnam", mine: "true" })).items[0]
      .workedMinutes,
  ).toBe(left.workedMinutes);
  expect(
    (await weekly("gangnam", left.workDate)).attendance.find(
      (a) => a.id === left.id,
    )?.workedMinutes,
  ).toBe(left.workedMinutes);
  expect((await getShift(shift.id)).attendance[0].workedMinutes).toBe(
    left.workedMinutes,
  );
});
it("retains current and cleanup rights after revocation, but staff cannot view another employee", async () => {
  const own = await attendanceApi.clockIn("gangnam", "own");
  const pause = await attendanceApi.command("break-start", own.version);
  store.user().memberships[0].status = "회수";
  expect((await attendanceApi.current()).attendance?.id).toBe(own.id);
  const resume = await attendanceApi.command("break-end", pause.version);
  await expect(
    attendanceApi.command("break-start", resume.version),
  ).rejects.toMatchObject({ status: 403 });
  await attendanceApi.command("clock-out", resume.version);
  store.persona = "minji";
  const other = await attendanceApi.clockIn("gangnam", "other");
  store.persona = "owner";
  expect((await attendanceApi.get(other.id)).employee.id).toBe("minji");
  store.persona = "junho";
  store.user().memberships[0].status = "활성";
  await expect(attendanceApi.get(other.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(
    (await attendanceApi.list({ scope: "gangnam", employeeId: "minji" })).items,
  ).toEqual([]);
});
it("computes seconds before flooring once and requires an actual membership even for OWNER", async () => {
  const row = store.add("attendance", "gangnam", {
    employeeId: "junho",
    status: "퇴근",
    startedAt: "2026-11-05T00:00:00Z",
    endedAt: "2026-11-05T09:00:00Z",
    workedMinutes: 999,
    breaks: [
      { start: "2026-11-05T03:00:00Z", end: "2026-11-05T03:30:30Z" },
      { start: "2026-11-05T06:00:00Z", end: "2026-11-05T06:10:45Z" },
    ],
  });
  expect((await attendanceApi.get(row.id)).workedMinutes).toBe(498);
  store.persona = "owner";
  store.user().memberships = [];
  await expect(attendanceApi.clockIn("gangnam", "owner")).rejects.toMatchObject(
    { status: 403 },
  );
});
