import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";
import { clearCsrf } from "../../shared/api/client";
import { lockerApi } from "./api";
import type { Locker, LockerAssignment, LockerAssignmentCreate } from "./model";

const locker: Locker = {
  id: "locker/1",
  version: 0,
  branchId: "b1",
  lockerNo: "A1",
  ratePer4WeeksKrw: 10000,
  status: "사용 가능",
  assignmentState: "사용 가능",
  activeAssignment: null,
};
const assignment: LockerAssignment = {
  id: "assignment/1",
  version: 0,
  branchId: "b1",
  locker: { id: locker.id, lockerNo: "A1" },
  customer: { id: "c1", memberNo: "C1", name: "고객" },
  status: "배정",
  startDate: "2030-01-01",
  endDate: "2030-01-29",
  overdue: false,
  returnedAt: null,
  assignedBy: { id: "owner", name: "사장님" },
  lastChangedBy: null,
  reason: null,
  charges: [
    {
      id: "charge1",
      kind: "최초",
      startDate: "2030-01-01",
      endDate: "2030-01-29",
      terms: 1,
      ratePer4WeeksKrw: 10000,
      amountKrw: 10000,
      status: "적용",
      paymentId: "payment1",
      createdAt: "2029-12-31T00:00:00Z",
      appliedAt: "2029-12-31T00:00:00Z",
    },
  ],
  createdAt: "2029-12-31T00:00:00Z",
  updatedAt: "2029-12-31T00:00:00Z",
};
const input: LockerAssignmentCreate = {
  branchId: "b1",
  lockerId: locker.id,
  customerId: "c1",
  startDate: assignment.startDate,
  endDate: assignment.endDate,
  method: "현금",
  mockOutcome: "APPROVED",
};
const server = setupServer(
  http.get("/api/auth/csrf", () => HttpResponse.json({ token: "csrf" })),
);
const signal = () => new AbortController().signal;
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  clearCsrf();
});

it("uses encoded identifiers and only documented scoped list filters", async () => {
  server.use(
    http.get("/api/lockers/:id", ({ params, request }) => {
      expect(params.id).toBe(locker.id);
      expect(new URL(request.url).searchParams.get("scope")).toBe("b1");
      return HttpResponse.json(locker);
    }),
    http.get("/api/lockers", ({ request }) => {
      expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
        scope: "b1",
        page: "2",
        pageSize: "10",
        assignmentState: "사용 가능",
      });
      return HttpResponse.json({
        items: [locker],
        meta: { page: 2, pageSize: 10, total: 11 },
      });
    }),
  );
  expect(await lockerApi.locker("b1", locker.id, signal())).toEqual(locker);
  expect(
    (
      await lockerApi.lockers(
        "b1",
        { page: 2, pageSize: 10, assignmentState: "사용 가능" },
        signal(),
      )
    ).items,
  ).toEqual([locker]);
});

it("strips client amount fields, retains logical idempotency and accepts failed payment results", async () => {
  const bodies: unknown[] = [],
    keys: (string | null)[] = [];
  server.use(
    http.post("/api/locker-assignments", async ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      bodies.push(await request.json());
      keys.push(request.headers.get("Idempotency-Key"));
      return HttpResponse.json(
        {
          ...assignment,
          status: "결제 실패",
          charges: assignment.charges!.map((row) => ({
            ...row,
            status: "실패",
            appliedAt: null,
          })),
        },
        { status: 201 },
      );
    }),
  );
  const failedInput = {
    ...input,
    mockOutcome: "FAILED" as const,
    amountKrw: 1,
  };
  for (let i = 0; i < 2; i++)
    expect(
      (
        await lockerApi.createAssignment(
          "b1",
          failedInput,
          signal(),
          "same-key",
        )
      ).status,
    ).toBe("결제 실패");
  expect(keys).toEqual(["same-key", "same-key"]);
  expect(bodies).toEqual([
    { ...input, mockOutcome: "FAILED" },
    { ...input, mockOutcome: "FAILED" },
  ]);
});

it("uses paid extension key and original date on failure; return moves no money and needs no key", async () => {
  const seen: { action: string; body: unknown; key: string | null }[] = [];
  server.use(
    http.post(
      "/api/locker-assignments/:id/:action",
      async ({ request, params }) => {
        seen.push({
          action: String(params.action),
          body: await request.json(),
          key: request.headers.get("Idempotency-Key"),
        });
        return HttpResponse.json(
          params.action === "return"
            ? {
                ...assignment,
                status: "반납",
                returnedAt: "2030-01-05T00:00:00Z",
              }
            : {
                ...assignment,
                charges: [
                  ...assignment.charges!,
                  {
                    ...assignment.charges![0],
                    id: "charge2",
                    kind: "연장",
                    startDate: "2030-01-29",
                    endDate: "2030-02-26",
                    status: "실패",
                    appliedAt: null,
                  },
                ],
              },
        );
      },
    ),
  );
  expect(
    (
      await lockerApi.extend(
        "b1",
        assignment.id,
        {
          version: 0,
          endDate: "2030-02-26",
          method: "카드",
          mockOutcome: "FAILED",
        },
        signal(),
        "extend-key",
      )
    ).endDate,
  ).toBe("2030-01-29");
  expect(
    (
      await lockerApi.returnLocker(
        "b1",
        assignment.id,
        { version: 0, reason: "조기 반납" },
        signal(),
      )
    ).endDate,
  ).toBe("2030-01-29");
  expect(seen).toEqual([
    {
      action: "extend",
      body: {
        version: 0,
        endDate: "2030-02-26",
        method: "카드",
        mockOutcome: "FAILED",
      },
      key: "extend-key",
    },
    { action: "return", body: { version: 0, reason: "조기 반납" }, key: null },
  ]);
});

it("accepts redacted charges and a blocked locker retaining its active assignment", async () => {
  server.use(
    http.get("/api/locker-assignments/:id", () =>
      HttpResponse.json({ ...assignment, charges: null }),
    ),
    http.get("/api/lockers/:id", () =>
      HttpResponse.json({
        ...locker,
        status: "운영 중단",
        assignmentState: "운영 중단",
        activeAssignment: {
          id: assignment.id,
          customer: assignment.customer,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          overdue: false,
        },
      }),
    ),
  );
  expect(
    (await lockerApi.assignment("b1", assignment.id, signal())).charges,
  ).toBeNull();
  expect(
    (await lockerApi.locker("b1", locker.id, signal())).activeAssignment?.id,
  ).toBe(assignment.id);
});

it("bulk rate updates use branch path and key without inventing a scope or amount", async () => {
  server.use(
    http.post("/api/branches/:id/locker-rate", async ({ request, params }) => {
      expect(params.id).toBe("branch/1");
      expect(new URL(request.url).search).toBe("");
      expect(request.headers.get("Idempotency-Key")).toBe("rate-key");
      expect(await request.json()).toEqual({ ratePer4WeeksKrw: 12000 });
      return HttpResponse.json({ updated: 3, ratePer4WeeksKrw: 12000 });
    }),
  );
  expect(
    await lockerApi.applyRate(
      "branch/1",
      { ratePer4WeeksKrw: 12000 },
      signal(),
      "rate-key",
    ),
  ).toEqual({ updated: 3, ratePer4WeeksKrw: 12000 });
});

it("retains conflict metadata and server field errors", async () => {
  server.use(
    http.patch("/api/lockers/:id", () =>
      HttpResponse.json(
        {
          code: "VERSION_CONFLICT",
          message: "다시 조회",
          latestVersion: 2,
          reloadUrl: "/api/lockers/1",
        },
        { status: 409 },
      ),
    ),
    http.post("/api/locker-assignments", () =>
      HttpResponse.json(
        {
          code: "VALIDATION_FAILED",
          message: "기간 확인",
          fieldErrors: { endDate: "28일 배수" },
        },
        { status: 422 },
      ),
    ),
  );
  await expect(
    lockerApi.updateLocker(
      "b1",
      locker.id,
      { version: 0, lockerNo: "A2" },
      signal(),
    ),
  ).rejects.toMatchObject({
    status: 409,
    detail: { latestVersion: 2, reloadUrl: "/api/lockers/1" },
  });
  await expect(
    lockerApi.createAssignment("b1", input, signal(), "key"),
  ).rejects.toMatchObject({
    status: 422,
    detail: { fieldErrors: { endDate: "28일 배수" } },
  });
});

it("rejects a 2xx paid or return response that did not apply the requested operation", async () => {
  server.use(
    http.post("/api/locker-assignments/:id/:action", () =>
      HttpResponse.json(assignment),
    ),
    http.post("/api/locker-assignments", () =>
      HttpResponse.json({ ...assignment, charges: null }, { status: 201 }),
    ),
  );
  await expect(
    lockerApi.extend(
      "b1",
      assignment.id,
      {
        version: 0,
        endDate: "2030-02-26",
        method: "카드",
        mockOutcome: "APPROVED",
      },
      signal(),
      "key",
    ),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  await expect(
    lockerApi.returnLocker("b1", assignment.id, { version: 0 }, signal()),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  await expect(
    lockerApi.createAssignment("b1", input, signal(), "key"),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
});

it.each([
  { ...assignment, id: "wrong" },
  { ...assignment, branchId: "wrong" },
  { ...assignment, endDate: "2030-02-30" },
  { ...assignment, charges: [{ ...assignment.charges![0], amountKrw: 1 }] },
  { ...assignment, charges: [{ ...assignment.charges![0], terms: 2 }] },
  { ...assignment, charges: [{ ...assignment.charges![0], paymentId: "" }] },
  { success: true },
])(
  "rejects malformed, mismatched or inconsistent assignment success",
  async (value) => {
    server.use(
      http.get("/api/locker-assignments/:id", () => HttpResponse.json(value)),
    );
    await expect(
      lockerApi.assignment("b1", assignment.id, signal()),
    ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  },
);

it("rejects wrong scope, duplicate branches and inconsistent occupancy counts", async () => {
  const count = {
    branchId: "b1",
    total: 3,
    inUse: 1,
    available: 1,
    blocked: 1,
    overdue: 1,
    asOf: "2030-01-01T00:00:00Z",
  };
  for (const items of [
    [{ ...count, branchId: "b2" }],
    [count, count],
    [{ ...count, total: 4 }],
  ]) {
    server.use(
      http.get("/api/lockers/occupancy", () => HttpResponse.json({ items })),
    );
    await expect(lockerApi.occupancy("b1", signal())).rejects.toMatchObject({
      detail: { code: "INVALID_RESPONSE" },
    });
  }
});
