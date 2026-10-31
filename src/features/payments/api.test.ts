import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { clearCsrf } from "../../shared/api/client";
import {
  createPayment,
  getPass,
  getPayment,
  listPasses,
  listPayments,
  refundPayment,
} from "./api";
import type { PaymentCreate } from "./model";
import { useSubmission } from "./useSubmission";

const server = setupServer(
  http.get("*/api/auth/csrf", () => HttpResponse.json({ token: "test-csrf" })),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  clearCsrf();
  sessionStorage.clear();
});
afterAll(() => server.close());

const body: PaymentCreate = {
  customerId: "customer-1",
  branchId: "branch-1",
  productId: "product-1",
  method: "카드",
  mockOutcome: "APPROVED",
};

it("sends canonical bounded payment/pass filters and preserves nullable pass fields", async () => {
  const seen: URL[] = [];
  server.use(
    http.get("*/api/payments", ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json({
        items: [{ amountKrw: 12345 }],
        meta: { page: 2, pageSize: 20, total: 25 },
      });
    }),
    http.get("*/api/passes", ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json({
        items: [
          { remainingMinutes: 45, remainingCreditKrw: null, expiresAt: null },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
    }),
  );
  const payments = await listPayments({
    scope: "branch-1",
    status: "승인",
    from: "2026-10-01T00:00:00Z",
    to: "2026-11-01T00:00:00Z",
    customerId: "customer-1",
    page: 2,
    pageSize: 20,
    sort: "amountKrw",
    direction: "asc",
  });
  expect(payments.items[0].amountKrw).toBe(12345);
  expect(Object.fromEntries(seen[0].searchParams)).toEqual({
    scope: "branch-1",
    status: "승인",
    from: "2026-10-01T00:00:00Z",
    to: "2026-11-01T00:00:00Z",
    customerId: "customer-1",
    page: "2",
    pageSize: "20",
    sort: "amountKrw",
    direction: "asc",
  });
  const passes = await listPasses({
    scope: "all",
    customerId: "customer-1",
    status: "활성",
    kind: "시간권",
  });
  expect(Object.fromEntries(seen[1].searchParams)).toEqual({
    scope: "all",
    customerId: "customer-1",
    status: "활성",
    kind: "시간권",
  });
  expect(passes.items[0]).toEqual({
    remainingMinutes: 45,
    remainingCreditKrw: null,
    expiresAt: null,
  });
});

it("escapes detail ids and sends the original purchase scope", async () => {
  const paths: string[] = [];
  server.use(
    http.get("*/api/:resource/:id", ({ request }) => {
      const url = new URL(request.url);
      paths.push(url.pathname + url.search);
      return HttpResponse.json({ id: "a/b" });
    }),
  );
  await getPayment("a/b", "branch-1");
  await getPass("a/b", "branch-1");
  expect(paths).toEqual([
    "/api/payments/a%2Fb?scope=branch-1",
    "/api/passes/a%2Fb?scope=branch-1",
  ]);
});

it.each(["APPROVED", "FAILED"] as const)(
  "sends official mockOutcome=%s without client amounts or legacy demo fields",
  async (mockOutcome) => {
    let received: unknown;
    let key: string | null = null;
    server.use(
      http.post("*/api/payments", async ({ request }) => {
        received = await request.json();
        key = request.headers.get("Idempotency-Key");
        expect(request.headers.get("X-CSRF-Token")).toBe("test-csrf");
        expect(new URL(request.url).searchParams.get("scope")).toBe("branch-1");
        return HttpResponse.json(
          {
            amountKrw: 17000,
            status: mockOutcome === "FAILED" ? "실패" : "승인",
            passId: mockOutcome === "FAILED" ? null : "pass-1",
          },
          { status: 201 },
        );
      }),
    );
    const result = await createPayment(
      {
        ...body,
        mockOutcome,
        amountKrw: 1,
        forceFailure: true,
      } as PaymentCreate,
      "payment-key-123456",
    );
    expect(received).toEqual({ ...body, mockOutcome });
    expect(key).toBe("payment-key-123456");
    expect(result.amountKrw).toBe(17000);
    expect(result.passId).toBe(mockOutcome === "FAILED" ? null : "pass-1");
  },
);

it("sends only the refund reason, key and original branch scope", async () => {
  server.use(
    http.post("*/api/payments/:id/refund", async ({ request }) => {
      expect(await request.json()).toEqual({ reason: "미사용 환불" });
      expect(request.headers.get("Idempotency-Key")).toBe("refund-key-123456");
      expect(new URL(request.url).searchParams.get("scope")).toBe("branch-1");
      return HttpResponse.json({ status: "환불", amountKrw: 17000 });
    }),
  );
  const result = await refundPayment(
    "payment-1",
    { reason: "미사용 환불", amountKrw: 1 } as { reason: string },
    "refund-key-123456",
    "branch-1",
  );
  expect(result.status).toBe("환불");
  expect(result.amountKrw).toBe(17000);
});

it.each(["payment", "refund"] as const)(
  "reuses the %s key after a lost response, including panel remount, then rotates on confirmed completion",
  async (operation) => {
    const keys: string[] = [];
    let loseResponse = true;
    const handler = async ({ request }: { request: Request }) => {
      keys.push(request.headers.get("Idempotency-Key")!);
      if (loseResponse) {
        loseResponse = false;
        return HttpResponse.error();
      }
      return HttpResponse.json({
        id: "payment-1",
        status: operation === "refund" ? "환불" : "승인",
      });
    };
    server.use(
      operation === "refund"
        ? http.post("*/api/payments/:id/refund", handler)
        : http.post("*/api/payments", handler),
    );
    const submit = (_body: PaymentCreate, key: string) =>
      operation === "refund"
        ? refundPayment("payment-1", { reason: "미사용" }, key)
        : createPayment(_body, key);
    const first = renderHook(() =>
      useSubmission(`user-1:${operation}`, submit),
    );
    await act(async () => {
      await expect(first.result.current.run(body)).rejects.toThrow();
    });
    first.unmount();
    const reopened = renderHook(() =>
      useSubmission(`user-1:${operation}`, submit),
    );
    await act(async () => {
      await reopened.result.current.run(body);
    });
    await act(async () => {
      await reopened.result.current.run(body);
    });
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    reopened.unmount();
  },
);

it("blocks duplicate submits synchronously, even from a second mounted form", async () => {
  let finish!: (value: string) => void;
  let calls = 0;
  const submit = async () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  const first = renderHook(() => useSubmission("user-2:payment", submit));
  const second = renderHook(() => useSubmission("user-2:payment", submit));
  await act(async () => {
    const pending = first.result.current.run(body);
    expect(await first.result.current.run(body)).toBeUndefined();
    expect(await second.result.current.run(body)).toBeUndefined();
    await waitFor(() => expect(calls).toBe(1));
    finish("done");
    await pending;
  });
  expect(first.result.current.pending).toBe(false);
  first.unmount();
  second.unmount();
});

it("persists a digest and random key without refund reason, customer ids or actor ids", async () => {
  const privateBody = {
    reason: "민감한 환불 사유",
    customerId: "private-customer",
  };
  const hook = renderHook(() =>
    useSubmission("private-actor:refund", async () => {
      throw new Error("lost response");
    }),
  );
  await act(async () => {
    await expect(hook.result.current.run(privateBody)).rejects.toThrow(
      "lost response",
    );
  });
  expect(sessionStorage.length).toBeGreaterThan(0);
  const entries = Object.entries(sessionStorage);
  expect(
    entries.every(([key]) =>
      /^openstudy:payment-intent:[0-9a-f]{64}$/.test(key),
    ),
  ).toBe(true);
  const persisted = JSON.stringify(entries);
  expect(persisted).not.toContain(privateBody.reason);
  expect(persisted).not.toContain(privateBody.customerId);
  expect(persisted).not.toContain("private-actor");
  hook.unmount();
});

it("ignores results completed after the submitting form unmounts", async () => {
  let finish!: (value: string) => void;
  const hook = renderHook(() =>
    useSubmission(
      "unmounted-actor:payment",
      async () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  let submitted!: Promise<string | undefined>;
  act(() => {
    submitted = hook.result.current.run(body);
  });
  await waitFor(() => expect(finish).toBeDefined());
  hook.unmount();
  finish("old-result");
  await expect(submitted).resolves.toBeUndefined();
});
