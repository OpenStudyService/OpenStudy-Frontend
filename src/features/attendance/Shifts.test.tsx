import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { clearCsrf } from "../../shared/api/client";
import type { Shift } from "./api";
import { Shifts } from "./Shifts";
const state = vi.hoisted(() => ({
  scope: "1",
  session: {
    user: {
      id: "manager",
      status: "활성",
      owner: false,
      memberships: [{ branchId: "1", role: "admin", permissions: [] }],
    },
    asOf: "2026-11-04T00:00:00Z",
  },
  lookups: {
    branches: [{ id: "1", name: "관리 지점", status: "운영 중" }],
    employees: [{ id: "worker", name: "근무 직원" }],
  },
}));
vi.mock("../../app/context", () => ({ useApp: () => state }));
const row: Shift = {
  id: "9007199254740995",
  version: 2,
  status: "예정",
  branchId: "1",
  employee: { id: "worker", name: "근무 직원" },
  startsAt: "2026-11-04T00:00:00Z",
  endsAt: "2026-11-04T09:00:00Z",
  workDate: "2026-11-04",
  plannedBreakMinutes: 30,
  plannedWorkMinutes: 510,
  cancellation: null,
  attendance: [],
  createdBy: { id: "manager", name: "관리자" },
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  canEdit: true,
};
const server = setupServer(
  http.get("/api/auth/csrf", () => HttpResponse.json({ token: "test-csrf" })),
  http.get("/api/shifts/weekly", () =>
    HttpResponse.json({ shifts: [], attendance: [] }),
  ),
  http.get("/api/shifts/:id", () => HttpResponse.json(row)),
);
let client: QueryClient;
beforeAll(() => server.listen());
beforeEach(() => {
  state.session.user.memberships[0].role = "admin";
});
afterEach(() => {
  cleanup();
  client?.clear();
  server.resetHandlers();
  clearCsrf();
});
afterAll(() => server.close());
function show(path = "/") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Shifts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("keeps input and renders visible and redacted conflicts through the real transport", async () => {
  const calls: { body: unknown; key: string | null; csrf: string | null }[] =
    [];
  server.use(
    http.post("/api/shifts", async ({ request }) => {
      calls.push({
        body: await request.json(),
        key: request.headers.get("Idempotency-Key"),
        csrf: request.headers.get("X-CSRF-Token"),
      });
      return HttpResponse.json(
        {
          code: "SHIFT_CONFLICT",
          message: "겹치는 근무",
          conflicts: [
            {
              kind: "근무",
              visible: false,
              label: "다른 지점 근무",
              overlapStartsAt: row.startsAt,
              overlapEndsAt: row.endsAt,
              shift: null,
            },
            {
              kind: "근무",
              visible: true,
              label: "근무",
              overlapStartsAt: row.startsAt,
              overlapEndsAt: row.endsAt,
              shift: { id: "1", branchId: "1" },
            },
          ],
        },
        { status: 409 },
      );
    }),
  );
  const user = show();
  await user.click(screen.getByRole("button", { name: "근무 등록" }));
  await user.selectOptions(screen.getByLabelText("근무 직원"), "worker");
  await user.click(screen.getByRole("button", { name: "등록하기" }));
  expect(await screen.findByText(/다른 지점 근무/)).toHaveTextContent("2026");
  expect(screen.getByLabelText("시작 (Asia/Seoul)")).toHaveValue(
    "2026-11-04T09:00",
  );
  await user.click(screen.getByRole("button", { name: "등록하기" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0]).toEqual({
    body: {
      branchId: "1",
      employeeId: "worker",
      startsAt: "2026-11-04T00:00:00.000Z",
      endsAt: "2026-11-04T09:00:00.000Z",
      plannedBreakMinutes: 0,
    },
    key: expect.any(String),
    csrf: "test-csrf",
  });
  expect(calls[1].key).toBe(calls[0].key);
});
it("sends mutable fields and version only for edits and cancels", async () => {
  const calls: { method: string; body: unknown; key: string | null }[] = [];
  const record = async ({ request }: { request: Request }) => {
    calls.push({
      method: request.method,
      body: await request.json(),
      key: request.headers.get("Idempotency-Key"),
    });
    return HttpResponse.json({ ...row, version: 3 });
  };
  server.use(
    http.patch("/api/shifts/:id", record),
    http.post("/api/shifts/:id/cancel", record),
  );
  const user = show("/?detail=" + row.id);
  await user.click(await screen.findByRole("button", { name: "근무 수정" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toEqual({
    method: "PATCH",
    body: {
      version: 2,
      startsAt: "2026-11-04T00:00:00.000Z",
      endsAt: "2026-11-04T09:00:00.000Z",
      plannedBreakMinutes: 30,
    },
    key: null,
  });
  await user.click(screen.getByRole("button", { name: "근무 취소" }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].body).toEqual({ version: 3 });
});
it("hides management buttons for staff even if a stale response says canEdit", async () => {
  state.session.user.memberships[0].role = "staff";
  show("/?detail=" + row.id);
  await screen.findByText(/실제 출퇴근 기록이 없습니다/);
  expect(screen.queryByRole("button", { name: "근무 등록" })).toBeNull();
  expect(screen.queryByRole("button", { name: "근무 수정" })).toBeNull();
  expect(screen.queryByRole("button", { name: "근무 취소" })).toBeNull();
});
