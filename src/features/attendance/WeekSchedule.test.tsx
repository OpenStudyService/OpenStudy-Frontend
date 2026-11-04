import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { WeekSchedule } from "./WeekSchedule";
import { seoulInput, seoulInstant, weekDays } from "./api";
const state = vi.hoisted(() => ({
  scope: "1",
  session: { user: { id: "staff" }, asOf: "2026-11-04T00:00:00Z" },
  lookups: { employees: [{ id: "other", name: "다른 직원" }], branches: [] },
}));
vi.mock("../../app/context", () => ({ useApp: () => state }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
let client: QueryClient;
beforeEach(() => {
  vi.mocked(api).mockReset();
});
afterEach(() => {
  cleanup();
  client?.clear();
});
function show() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WeekSchedule onSelect={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("shows only response employees and puts a Sunday overnight shift in its start day once", async () => {
  vi.mocked(api).mockResolvedValue({
    weekStart: "2026-11-02",
    weekEnd: "2026-11-08",
    shifts: [
      {
        id: "big-1",
        employee: { id: "staff", name: "본인" },
        branchId: "1",
        startsAt: "2026-11-08T13:00:00Z",
        endsAt: "2026-11-08T21:00:00Z",
        workDate: "2026-11-08",
        plannedBreakMinutes: 30,
        plannedWorkMinutes: 450,
      },
    ],
    attendance: [],
  });
  show();
  const row = await screen.findByRole("rowheader", { name: "본인" });
  const cells = within(row.parentElement!).getAllByRole("cell");
  expect(
    within(cells[6]).getByRole("button", { name: /예정 근무/ }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: /예정 근무/ })).toHaveLength(1);
  expect(screen.queryByText("다른 직원")).toBeNull();
  expect(api).toHaveBeenCalledWith(
    "/shifts/weekly?scope=1&weekOf=2026-11-04",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it("separates actual work and renders the server minutes without recalculation", async () => {
  vi.mocked(api).mockResolvedValue({
    shifts: [],
    attendance: [
      {
        id: "actual",
        employee: { id: "staff", name: "본인" },
        branchId: "1",
        workDate: "2026-11-04",
        clockInAt: "2026-11-04T00:00:00Z",
        clockOutAt: "2026-11-04T09:00:00Z",
        status: "퇴근",
        workedMinutes: 498,
      },
    ],
  });
  show();
  expect(await screen.findByText(/실근무 498분/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /예정 근무/ })).toBeNull();
});
it("does not substitute lookups on a failed request", async () => {
  vi.mocked(api).mockRejectedValue(new Error("연결 실패"));
  show();
  expect(
    await screen.findByText(/근무표 데이터를 불러오지 못했어요/),
  ).toBeVisible();
  expect(screen.queryByText("다른 직원")).toBeNull();
});
it("uses Seoul wall time and ISO Monday boundaries independently of host timezone", () => {
  expect(seoulInstant("2026-11-09T08:00")).toBe("2026-11-08T23:00:00.000Z");
  expect(seoulInput("2026-11-08T23:00:00Z")).toBe("2026-11-09T08:00");
  expect(weekDays("2026-11-08")).toEqual([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
});
