/** Stateful HTTP fixtures exercise the UI/transport boundary, not Backend storage. */
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import { ClockCard } from "./ClockCard";
import { AttendanceRecords } from "./AttendanceRecords";
import { attendanceApi, type AttendanceRecord } from "./attendance-api";
import { clearCsrf } from "../../shared/api/client";
const app = vi.hoisted(() => ({
  scope: "1",
  session: {
    user: {
      id: "3",
      status: "활성",
      owner: false,
      memberships: [
        { branchId: "1", role: "staff", permissions: [], status: "활성" },
      ],
    },
    asOf: "2026-11-05T00:00:00Z",
  },
  lookups: {
    branches: [
      { id: "1", name: "활성 지점", status: "운영 중" },
      { id: "2", name: "운영 중지 지점", status: "운영 중지" },
    ],
    employees: [{ id: "3", name: "본인" }],
  },
}));
vi.mock("../../app/context", () => ({ useApp: () => app }));
const sample: AttendanceRecord = {
  id: "9007199254740995",
  version: 4,
  branchId: "1",
  employee: { id: "3", name: "본인" },
  status: "근무 중",
  shiftId: null,
  clockInAt: "2026-11-05T00:00:00Z",
  clockOutAt: null,
  workDate: "2026-11-05",
  breaks: [],
  workedMinutes: null,
};
let current: AttendanceRecord | null, last: AttendanceRecord | null;
const writes: {
  path: string;
  body: unknown;
  key: string | null;
  csrf: string | null;
}[] = [];
async function write({ request }: { request: Request }) {
  const path = new URL(request.url).pathname;
  writes.push({
    path,
    body: await request.json(),
    key: request.headers.get("Idempotency-Key"),
    csrf: request.headers.get("X-CSRF-Token"),
  });
  if (path.endsWith("clock-in")) current = { ...sample };
  if (path.endsWith("break-start"))
    current = { ...current!, version: current!.version + 1, status: "휴게 중" };
  if (path.endsWith("break-end"))
    current = { ...current!, version: current!.version + 1, status: "근무 중" };
  if (path.endsWith("clock-out")) {
    last = {
      ...current!,
      version: current!.version + 1,
      status: "퇴근",
      clockOutAt: "2026-11-05T09:00:00Z",
      workedMinutes: 498,
    };
    current = null;
    return HttpResponse.json(last);
  }
  return HttpResponse.json(current, {
    status: path.endsWith("clock-in") ? 201 : 200,
  });
}
const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "fixture-csrf" }),
  ),
  http.get("/api/me/attendance/current", () =>
    HttpResponse.json({ attendance: current, asOf: "2026-11-05T09:00:00Z" }),
  ),
  http.get("/api/attendance-records", () =>
    HttpResponse.json({
      items: last ? [last] : [],
      meta: { page: 1, pageSize: 20, total: last ? 1 : 0 },
    }),
  ),
  http.get("/api/attendance-records/:id", () =>
    HttpResponse.json(last ?? sample),
  ),
  http.post("/api/me/attendance/:action", write),
);
let client: QueryClient;
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  current = null;
  last = null;
  writes.length = 0;
  app.scope = "1";
  app.session.user.memberships[0].role = "staff";
});
afterEach(() => {
  cleanup();
  client?.clear();
  clearCsrf();
  server.resetHandlers();
});
function show(node = <ClockCard />, path = "/") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
async function enabled(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}
it("uses only permitted state commands with exact CSRF, version and creation-key payloads", async () => {
  const user = show();
  await user.click(await enabled("출근하기"));
  await user.click(await enabled("휴게 시작"));
  expect(screen.queryByRole("button", { name: "퇴근하기" })).toBeNull();
  await user.click(await enabled("휴게 종료"));
  await user.click(await enabled("퇴근하기"));
  await screen.findByText("퇴근", { selector: ".badge" });
  expect(
    writes.map((w) => ({
      path: w.path,
      body: w.body,
      key: w.key,
      csrf: w.csrf,
    })),
  ).toEqual([
    {
      path: "/api/me/attendance/clock-in",
      body: { branchId: "1" },
      key: expect.any(String),
      csrf: "fixture-csrf",
    },
    {
      path: "/api/me/attendance/break-start",
      body: { version: 4 },
      key: null,
      csrf: "fixture-csrf",
    },
    {
      path: "/api/me/attendance/break-end",
      body: { version: 5 },
      key: null,
      csrf: "fixture-csrf",
    },
    {
      path: "/api/me/attendance/clock-out",
      body: { version: 6 },
      key: null,
      csrf: "fixture-csrf",
    },
  ]);
  expect(screen.queryByRole("option", { name: "운영 중지 지점" })).toBeNull();
});
it("keeps the creation key after ambiguous failures and checks authoritative current after a stale replay", async () => {
  const keys: string[] = [];
  let count = 0;
  server.use(
    http.post("/api/me/attendance/clock-in", ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key")!);
      if (count++ === 0) return HttpResponse.error();
      last = {
        ...sample,
        status: "퇴근",
        clockOutAt: "2026-11-05T09:00:00Z",
        workedMinutes: 498,
      };
      return HttpResponse.json(sample, { status: 201 });
    }),
  );
  const user = show();
  await user.click(await enabled("출근하기"));
  await screen.findByRole("alert");
  await user.click(await enabled("출근하기"));
  await screen.findByText("퇴근", { selector: ".badge" });
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(screen.queryByRole("button", { name: "휴게 시작" })).toBeNull();
});
it("blocks commands until current is loaded and on invalid or failed current responses", async () => {
  server.use(
    http.get("/api/me/attendance/current", () => HttpResponse.json({})),
  );
  show();
  await screen.findByText(/본인 현재 근태를 불러오지 못했어요/);
  expect(screen.queryByRole("button", { name: "출근하기" })).toBeNull();
  expect(writes).toEqual([]);
});
it("reconciles a real error response without automatically replaying a state command", async () => {
  current = { ...sample };
  server.use(
    http.post("/api/me/attendance/break-start", () => {
      current = { ...sample, status: "휴게 중", version: 5 };
      return HttpResponse.json(
        { code: "VERSION_CONFLICT", message: "최신 상태를 확인해 주세요." },
        { status: 409 },
      );
    }),
  );
  const user = show();
  await user.click(await enabled("휴게 시작"));
  await screen.findByRole("alert");
  expect(await enabled("휴게 종료")).toBeVisible();
  expect(screen.queryByRole("button", { name: "퇴근하기" })).toBeNull();
});
it("allows finishing an ongoing record after membership revocation and ignores selected scope", async () => {
  current = { ...sample, branchId: "2" };
  app.scope = "all";
  const user = show();
  expect(
    await screen.findByRole("button", { name: "휴게 시작" }),
  ).toBeDisabled();
  await user.click(await enabled("퇴근하기"));
  expect(writes[0].body).toEqual({ version: 4 });
});
it("uses server minutes identically in list and detail, with no staff filter or proxy command", async () => {
  last = {
    ...sample,
    status: "퇴근",
    workedMinutes: 498,
    clockOutAt: "2026-11-05T09:00:00Z",
  };
  const user = show(<AttendanceRecords />);
  const row = await screen.findByRole("cell", { name: "498분" });
  expect(row).toBeVisible();
  expect(screen.queryByLabelText("근태 직원")).toBeNull();
  expect(screen.queryByLabelText("조회 대상")).toBeNull();
  await user.click(screen.getByRole("button", { name: "2026-11-05 09:00" }));
  const panel = await screen.findByRole("dialog");
  expect(await within(panel).findByText("실근무: 498분")).toBeVisible();
  expect(
    within(panel).queryByRole("button", { name: /출근하기|퇴근하기|휴게/ }),
  ).toBeNull();
});
it("rejects malformed list and detail rather than showing an empty success", async () => {
  server.use(
    http.get("/api/attendance-records", () =>
      HttpResponse.json({ items: [], meta: { total: 0 } }),
    ),
    http.get("/api/attendance-records/:id", () => HttpResponse.json({})),
  );
  await expect(attendanceApi.list({ scope: "1" })).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
  await expect(attendanceApi.get("1")).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
});
