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
  const sunday = await screen.findByRole("region", {
    name: "2026-11-08 일요일",
  });
  expect(
    within(sunday).getByRole("button", {
      name: /예정 근무.*본인.*22:00–다음 날 06:00/,
    }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: /예정 근무/ })).toHaveLength(1);
  expect(screen.queryByText("다른 직원")).toBeNull();
  expect(api).toHaveBeenCalledWith(
    "/shifts/weekly?scope=1&weekOf=2026-11-04",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it("groups employees by Seoul minute and action and places overnight events on their own date", async () => {
  vi.mocked(api).mockResolvedValue({
    shifts: [
      {
        id: "planned",
        employee: { id: "staff", name: "본인" },
        branchId: "1",
        startsAt: "2026-11-04T00:00:00Z",
        endsAt: "2026-11-04T09:00:00Z",
        workDate: "2026-11-04",
        plannedBreakMinutes: 60,
        plannedWorkMinutes: 480,
      },
    ],
    attendance: [
      {
        id: "actual",
        employee: { id: "staff", name: "본인" },
        branchId: "1",
        workDate: "2026-11-04",
        clockInAt: "2026-11-04T00:00:00Z",
        clockOutAt: "2026-11-04T16:00:00Z",
        status: "퇴근",
        breaks: [
          {
            startedAt: "2026-11-04T14:30:00Z",
            endedAt: "2026-11-04T15:30:00Z",
          },
        ],
      },
      {
        id: "working",
        employee: { id: "coworker", name: "동료" },
        branchId: "1",
        workDate: "2026-11-04",
        clockInAt: "2026-11-04T00:00:42Z",
        clockOutAt: null,
        breaks: [{ startedAt: "2026-11-04T14:30:05Z", endedAt: null }],
      },
    ],
  });
  show();
  const wed = within(
    await screen.findByRole("region", { name: "2026-11-04 수요일" }),
  );
  expect(wed.getByRole("button", { name: /예정 근무.*본인/ })).toBeVisible();
  const arrival = wed.getByText("출근", { exact: true }).closest("li");
  expect(arrival).toHaveTextContent("09:00 출근 · 동료, 본인");
  expect(wed.getByText("휴게 시작").closest("li")).toHaveTextContent(
    "23:30 휴게 시작 · 동료, 본인",
  );
  expect(wed.queryByText("퇴근", { exact: true })).toBeNull();
  const thu = within(screen.getByRole("region", { name: "2026-11-05 목요일" }));
  expect(thu.getByText("휴게 끝").closest("li")).toHaveTextContent(
    "00:30 휴게 끝 · 본인",
  );
  expect(
    thu.getByText("퇴근", { exact: true }).closest("li"),
  ).toHaveTextContent("01:00 퇴근 · 본인");
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
