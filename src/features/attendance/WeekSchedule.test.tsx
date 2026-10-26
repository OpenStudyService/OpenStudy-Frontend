import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LookupEmployee } from "../../shared/domain/schema";
import { api } from "../../shared/api/client";
import { WeekSchedule } from "./WeekSchedule";

const state = vi.hoisted(() => ({
  scope: "1",
  session: { user: { id: "viewer" }, asOf: "2026-10-26T00:00:00Z" },
  lookups: { employees: [] as LookupEmployee[], branches: [] },
}));
vi.mock("../../app/context", () => ({ useApp: () => state }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.mocked(api)
    .mockReset()
    .mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 100, total: 0 },
    });
  state.scope = "1";
  state.lookups.employees = [];
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WeekSchedule onSelect={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renders minimum employee names from the current authorized lookup scope", async () => {
  const employees = [{ id: "20", name: "허용 지점 직원" }];
  state.lookups.employees = employees;
  show();
  expect(
    await screen.findByRole("rowheader", { name: "허용 지점 직원" }),
  ).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "직원" })).toBeVisible();
  expect(employees).toEqual([{ id: "20", name: "허용 지점 직원" }]);
});

it("preserves legacy schedule exclusions when owner and membership metadata is supplied", async () => {
  state.lookups.employees = [
    { id: "owner", name: "소유자", owner: true, memberships: [] },
    {
      id: "one",
      name: "현재 지점 직원",
      memberships: [{ branchId: "1", role: "staff", permissions: [] }],
    },
    {
      id: "two",
      name: "다른 지점 직원",
      memberships: [{ branchId: "2", role: "staff", permissions: [] }],
    },
  ];
  show();
  expect(
    await screen.findByRole("rowheader", { name: "현재 지점 직원" }),
  ).toBeVisible();
  expect(screen.queryByRole("rowheader", { name: "소유자" })).toBeNull();
  expect(
    screen.queryByRole("rowheader", { name: "다른 지점 직원" }),
  ).toBeNull();
});

it("keeps an explicitly unassigned legacy employee out of the all-branch schedule", async () => {
  state.scope = "all";
  state.lookups.employees = [
    { id: "minimum", name: "최소 선택 정보 직원" },
    {
      id: "assigned",
      name: "소속 직원",
      memberships: [{ branchId: "2", role: "staff", permissions: [] }],
    },
    { id: "unassigned", name: "미배정 직원", owner: false, memberships: [] },
  ];
  show();
  expect(
    await screen.findByRole("rowheader", { name: "최소 선택 정보 직원" }),
  ).toBeVisible();
  expect(screen.getByRole("rowheader", { name: "소속 직원" })).toBeVisible();
  expect(screen.queryByRole("rowheader", { name: "미배정 직원" })).toBeNull();
});
