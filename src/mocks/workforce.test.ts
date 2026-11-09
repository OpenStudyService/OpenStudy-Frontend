import { beforeAll, afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";
import { workforceHandlers } from "./workforce";
import { store } from "./store";
import { api, ApiError, clearCsrf } from "../shared/api/client";
import { getShift, weekly, type Shift } from "../features/attendance/api";
import { attendanceHandlers } from "./attendance";
import { attendanceApi } from "../features/attendance/attendance-api";
import type { Correction, Swap } from "../features/attendance/request-api";
const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "openstudy-mock-csrf" }),
  ),
  ...workforceHandlers,
  ...attendanceHandlers,
);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "minji";
});
afterEach(() => {
  clearCsrf();
  server.resetHandlers();
});
const input = {
  branchId: "gangnam",
  employeeId: "junho",
  startsAt: "2036-11-02T22:00:00+09:00",
  endsAt: "2036-11-03T06:00:00+09:00",
  plannedBreakMinutes: 30,
};
it("shares a canonical create/edit/cancel ledger and excludes cancelled shifts from weekly", async () => {
  const created = await api<Shift>("/shifts", {
    method: "POST",
    body: input,
    key: "one",
  });
  expect(created.employee.id).toBe("junho");
  expect(created.workDate).toBe("2036-11-02");
  expect(created.plannedWorkMinutes).toBe(450);
  expect(
    (await weekly("gangnam", "2036-11-02")).shifts.map((s) => s.id),
  ).toContain(created.id);
  const updated = await api<Shift>(`/shifts/${created.id}`, {
    method: "PATCH",
    body: {
      version: created.version,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      plannedBreakMinutes: 60,
    },
  });
  expect(updated.plannedWorkMinutes).toBe(420);
  const cancelled = await api<Shift>(`/shifts/${created.id}/cancel`, {
    method: "POST",
    body: { version: updated.version },
  });
  expect(cancelled.status).toBe("취소");
  expect((await getShift(created.id)).cancellation).not.toBeNull();
  expect((await weekly("gangnam", "2036-11-02")).shifts).toHaveLength(0);
});
it("returns the same creation for an idempotent retry and rejects a stale edit", async () => {
  const options = { method: "POST", body: input, key: "same" };
  const a = await api<Shift>("/shifts", options),
    b = await api<Shift>("/shifts", options);
  expect(a.id).toBe(b.id);
  await expect(
    api(`/shifts/${a.id}`, {
      method: "PATCH",
      body: {
        version: a.version + 1,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        plannedBreakMinutes: 0,
      },
    }),
  ).rejects.toMatchObject({
    status: 409,
    detail: { code: "VERSION_CONFLICT" },
  });
});
it("rejects staff writes and hides other employees' weekly records", async () => {
  await api("/shifts", { method: "POST", body: input, key: "one" });
  await api("/shifts", {
    method: "POST",
    body: { ...input, employeeId: "minji" },
    key: "two",
  });
  store.persona = "junho";
  expect(
    (await weekly("gangnam", "2036-11-02")).shifts.map((s) => s.employee.id),
  ).toEqual(["junho"]);
  await expect(
    api("/shifts", { method: "POST", body: input, key: "three" }),
  ).rejects.toMatchObject({ status: 403 });
});
it("redacts conflicting shifts outside the manager's scope", async () => {
  store.db.employees
    .find((e) => e.id === "junho")!
    .memberships.push({ branchId: "seongsu", role: "staff", permissions: [] });
  store.persona = "owner";
  await api("/shifts", {
    method: "POST",
    body: { ...input, branchId: "seongsu" },
    key: "hidden",
  });
  store.persona = "minji";
  try {
    await api("/shifts", { method: "POST", body: input, key: "conflict" });
    throw new Error("Expected conflict");
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).detail).toMatchObject({
      code: "SHIFT_CONFLICT",
      conflicts: [{ label: "다른 지점 근무", visible: false, shift: null }],
    });
  }
});
const correctionInput = {
  kind: "출퇴근",
  clockInAt: "2025-05-01T00:00:00Z",
  clockOutAt: "2025-05-01T08:30:00Z",
  reason: "퇴근 시각 정정",
};
function closedAttendance() {
  return store.add("attendance", "gangnam", {
    employeeId: "junho",
    startedAt: correctionInput.clockInAt,
    endedAt: "2025-05-01T09:00:00Z",
    breaks: [{ start: "2025-05-01T03:00:00Z", end: "2025-05-01T03:30:00Z" }],
    status: "퇴근",
    workedMinutes: 510,
  });
}

it("replays a correction creation and returns pending and version targets", async () => {
  const row = closedAttendance();
  store.persona = "junho";
  const path = `/attendance-records/${row.id}/corrections`;
  const options = { method: "POST", body: correctionInput, key: "correction" };
  const created = await api<Correction>(path, options);
  expect(await api(path, options)).toEqual(created);
  expect(created).toMatchObject({
    canApprove: false,
    canReject: false,
    canCancel: true,
  });
  await expect(api(path, { ...options, key: "other" })).rejects.toMatchObject({
    status: 409,
    detail: { code: "CORRECTION_PENDING", pendingCorrectionId: created.id },
  });
  store.persona = "minji";
  const approval = `/attendance-corrections/${created.id}/approve`;
  await expect(
    api(approval, { method: "POST", body: { version: created.version + 1 } }),
  ).rejects.toMatchObject({
    status: 409,
    detail: {
      code: "VERSION_CONFLICT",
      latestVersion: created.version,
      reloadUrl: `/api/attendance-corrections/${created.id}`,
    },
  });
  const approved = await api<Correction>(approval, {
    method: "POST",
    body: { version: created.version },
  });
  expect(approved).toMatchObject({
    status: "승인",
    decision: { by: { id: "minji" }, reason: null },
  });
  expect(await attendanceApi.get(row.id)).toMatchObject({ workedMinutes: 480 });
});

it("requires a correction rejection reason and reads it back with the decision", async () => {
  const row = closedAttendance();
  store.persona = "junho";
  const created = await api<Correction>(
    `/attendance-records/${row.id}/corrections`,
    {
      method: "POST",
      body: correctionInput,
      key: "correction",
    },
  );
  const path = `/attendance-corrections/${created.id}`;
  const body = { version: created.version };
  store.persona = "minji";
  for (const invalid of [
    body,
    { ...body, reason: " " },
    { ...body, reason: "가".repeat(501) },
  ]) {
    await expect(
      api(`${path}/reject`, { method: "POST", body: invalid }),
    ).rejects.toMatchObject({ status: 422 });
  }
  await api(`${path}/reject`, {
    method: "POST",
    body: { ...body, reason: "시각을 확인해 주세요." },
  });
  expect(await api(path)).toMatchObject({
    status: "반려",
    canApprove: false,
    decision: { by: { id: "minji" }, reason: "시각을 확인해 주세요." },
  });
  expect(await attendanceApi.get(row.id)).toMatchObject({ workedMinutes: 510 });
});

it("passes the shift version for swap approval and restores the original shift", async () => {
  const shift = await api<Shift>("/shifts", {
    method: "POST",
    body: input,
    key: "shift",
  });
  store.persona = "junho";
  const body = {
    replacementEmployeeId: "minji",
    proposedStartsAt: input.startsAt,
    proposedEndsAt: input.endsAt,
    reason: "대체근무 요청",
  };
  const swap = await api<Swap>(`/shifts/${shift.id}/swaps`, {
    method: "POST",
    body,
    key: "swap",
  });
  const path = `/shift-swaps/${swap.id}`;
  store.persona = "minji";
  await expect(
    api(`${path}/reject`, {
      method: "POST",
      body: { version: swap.version, reason: "추가 필드" },
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    api(`${path}/approve`, {
      method: "POST",
      body: { version: swap.version, shiftVersion: shift.version + 1 },
    }),
  ).rejects.toMatchObject({
    status: 409,
    detail: {
      shiftId: shift.id,
      latestVersion: shift.version,
      reloadUrl: `/api/shifts/${shift.id}`,
    },
  });
  const approved = await api<Swap>(`${path}/approve`, {
    method: "POST",
    body: { version: swap.version, shiftVersion: shift.version },
  });
  expect((await getShift(shift.id)).employee.id).toBe("minji");
  expect(
    await api(`${path}/cancel-approval`, {
      method: "POST",
      body: { version: approved.version },
    }),
  ).toMatchObject({ status: "취소", cancellation: { kind: "승인 취소" } });
  expect((await getShift(shift.id)).employee.id).toBe("junho");
});
it("returns break IDs and merges private attendance conflicts without record IDs", async () => {
  const target = closedAttendance();
  store.persona = "junho";
  const path = `/attendance-records/${target.id}/corrections`;
  await expect(
    api(path, {
      method: "POST",
      key: "outside",
      body: { ...correctionInput, clockOutAt: "2025-05-01T02:30:00Z" },
    }),
  ).rejects.toMatchObject({
    status: 409,
    detail: { code: "CORRECTION_BREAK_OUTSIDE", breakIds: ["0"] },
  });
  const created = await api<Correction>(path, {
    method: "POST",
    body: correctionInput,
    key: "correction",
  });
  for (const end of ["2025-05-01T08:00:00Z", "2025-05-01T08:15:00Z"]) {
    store.add("attendance", "seongsu", {
      employeeId: "junho",
      startedAt: "2025-05-01T07:00:00Z",
      endedAt: end,
      breaks: [],
      status: "퇴근",
      workedMinutes: 60,
    });
  }
  store.persona = "minji";
  await expect(
    api(`/attendance-corrections/${created.id}/approve`, {
      method: "POST",
      body: { version: created.version },
    }),
  ).rejects.toMatchObject({
    status: 409,
    detail: {
      code: "CORRECTION_OVERLAP",
      attendanceConflicts: [
        {
          visible: false,
          attendanceRecordId: null,
          label: "다른 지점 근태",
          overlapStartsAt: "2025-05-01T07:00:00.000Z",
          overlapEndsAt: "2025-05-01T08:15:00.000Z",
        },
      ],
    },
  });
});
