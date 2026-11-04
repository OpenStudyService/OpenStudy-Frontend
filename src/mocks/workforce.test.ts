import { beforeAll, afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";
import { workforceHandlers } from "./workforce";
import { store } from "./store";
import { api, ApiError, clearCsrf } from "../shared/api/client";
import { getShift, weekly, type Shift } from "../features/attendance/api";
const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "openstudy-mock-csrf" }),
  ),
  ...workforceHandlers,
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
