import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import { paymentHandlers } from "./payments";
import { MockStore, store } from "./store";
import type { components } from "../shared/api/foundation.generated";

type Payment = components["schemas"]["Payment"];
type Pass = components["schemas"]["Pass"];
const server = setupServer(...paymentHandlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const url = (path: string) => new URL(`/api${path}`, window.location.origin);
const createBody = {
  customerId: "member-1",
  branchId: "gangnam",
  productId: "time100",
  method: "카드",
  mockOutcome: "APPROVED",
};
function post(path: string, body: object, key = crypto.randomUUID()) {
  return fetch(url(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}
const get = (path: string) => fetch(url(path));

it("approves once on concurrent key replay, takes server price, and preserves purchase terms", async () => {
  const count = store.db.passes.length,
    key = crypto.randomUUID();
  const responses = await Promise.all([
    post("/payments", createBody, key),
    post("/payments", createBody, key),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const [first, second] = await Promise.all(
    responses.map((r) => r.json() as Promise<Payment>),
  );
  expect(second).toEqual(first);
  expect(first).toMatchObject({
    mock: true,
    amountKrw: 120000,
    status: "승인",
    customer: { id: "member-1" },
  });
  expect(store.db.passes).toHaveLength(count + 1);
  const before = (await (await get(`/passes/${first.passId}`)).json()) as Pass;
  store.get("products", "time100").priceKrw = 999;
  store.get("products", "time100").name = "변경 상품";
  store.get("products", "time100").terms = {
    kind: "시간권",
    includedMinutes: 1,
    validDays: null,
  };
  const after = await (await get(`/passes/${first.passId}`)).json();
  expect(after).toEqual(before);
  expect(after.startedAt).toBe(first.approvedAt);
  expect(
    (await post("/payments", { ...createBody, method: "현금" }, key)).status,
  ).toBe(409);
  expect(
    (await post("/payments", { ...createBody, amountKrw: 1 })).status,
  ).toBe(422);
});

it("records a FAILED result without issuing a pass, including replay", async () => {
  const count = store.db.passes.length,
    key = crypto.randomUUID(),
    body = { ...createBody, mockOutcome: "FAILED" };
  const response = await post("/payments", body, key),
    payment = await response.json();
  expect(response.status).toBe(201);
  expect(payment).toMatchObject({
    status: "실패",
    passId: null,
    approvedAt: null,
    canRefund: false,
  });
  expect((await post("/payments", body, key)).status).toBe(201);
  expect(store.db.passes).toHaveLength(count);
  expect(
    (await post(`/payments/${payment.id}/refund`, { reason: "실패 환불" }))
      .status,
  ).toBe(409);
});

it("shows canonical type balances, starts and null expiry, and filters effective expired status", async () => {
  store.get("products", "time100").terms = {
    kind: "시간권",
    includedMinutes: 60,
    validDays: null,
  };
  const time = (await (await post("/payments", createBody)).json()) as Payment;
  const pass = (await (await get(`/passes/${time.passId}`)).json()) as Pass;
  expect(pass).toMatchObject({
    kind: "시간권",
    remainingMinutes: 60,
    remainingCreditKrw: null,
    expiresAt: null,
    used: false,
    canRefund: true,
  });
  expect(pass.startedAt).toBe(time.approvedAt);
  store.get("passes", pass.id).expiresAt = "2020-01-01T00:00:00Z";
  const result = await (
    await get("/passes?customerId=member-1&status=만료")
  ).json();
  expect(
    result.items.some(
      (p: Pass) => p.id === pass.id && p.status === "만료" && !p.canRefund,
    ),
  ).toBe(true);
  const credit = (await (
    await post("/payments", { ...createBody, productId: "credit" })
  ).json()) as Payment;
  expect(await (await get(`/passes/${credit.passId}`)).json()).toMatchObject({
    remainingMinutes: null,
    remainingCreditKrw: 100000,
  });
});

it("allows write-only cashier refunds at the original branch, atomically and idempotently", async () => {
  const payment = (await (
    await post("/payments", createBody)
  ).json()) as Payment;
  store.persona = "junho";
  store.user().memberships[0].permissions = ["payments:write"];
  expect((await get(`/payments/${payment.id}`)).status).toBe(403);
  const passBefore = (await (
    await get(`/passes/${payment.passId}`)
  ).json()) as Pass;
  expect(passBefore.canRefund).toBe(true);
  const key = crypto.randomUUID(),
    response = await post(
      `/payments/${payment.id}/refund`,
      { reason: "미사용 환불" },
      key,
    ),
    refunded = (await response.json()) as Payment;
  expect(response.status).toBe(200);
  expect(refunded).toMatchObject({
    amountKrw: payment.amountKrw,
    approvedAt: payment.approvedAt,
    status: "환불",
    refund: {
      amountKrw: payment.amountKrw,
      reason: "미사용 환불",
      processingBranchId: "gangnam",
      processedBy: { id: "junho" },
    },
  });
  expect(
    await (
      await post(
        `/payments/${payment.id}/refund`,
        { reason: "미사용 환불" },
        key,
      )
    ).json(),
  ).toEqual(refunded);
  expect(await (await get(`/passes/${payment.passId}`)).json()).toMatchObject({
    status: "환불",
    startedAt: passBefore.startedAt,
    expiresAt: passBefore.expiresAt,
    canRefund: false,
  });
  expect(
    (await post(`/payments/${payment.id}/refund`, { reason: "미사용 환불" }))
      .status,
  ).toBe(409);
});

it("rejects used, expired, wrong-branch and unauthorized refunds", async () => {
  const payment = (await (
      await post("/payments", createBody)
    ).json()) as Payment,
    pass = store.get("passes", payment.passId!);
  pass.used = true;
  expect(
    await (
      await post(`/payments/${payment.id}/refund`, { reason: "환불" })
    ).json(),
  ).toMatchObject({ code: "PASS_ALREADY_USED" });
  pass.used = false;
  pass.expiresAt = "2020-01-01T00:00:00Z";
  expect(
    await (
      await post(`/payments/${payment.id}/refund`, { reason: "환불" })
    ).json(),
  ).toMatchObject({ code: "PASS_EXPIRED" });
  store.persona = "junho";
  expect(
    (await post(`/payments/${payment.id}/refund`, { reason: "환불" })).status,
  ).toBe(403);
  store.persona = "yujin";
  expect(
    (await post(`/payments/${payment.id}/refund`, { reason: "환불" })).status,
  ).toBe(404);
  expect(store.get("payments", payment.id).status).toBe("승인");
});

it("bounds list scope, customer, status and date filters", async () => {
  await post("/payments", createBody);
  const result = await (
    await get(
      "/payments?scope=gangnam&customerId=member-1&status=승인&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z",
    )
  ).json();
  expect(result.items.length).toBeGreaterThan(0);
  expect(
    result.items.every(
      (p: Payment) =>
        p.branchId === "gangnam" &&
        p.customer.id === "member-1" &&
        p.status === "승인",
    ),
  ).toBe(true);
  expect((await get("/payments?pageSize=101")).status).toBe(422);
  expect((await get("/payments?from=2026-10-01")).status).toBe(422);
});

it("rejects expiry exactly at the boundary and permits only one concurrent refund", async () => {
  const payment = (await (
    await post("/payments", createBody)
  ).json()) as Payment;
  const pass = store.get("passes", payment.passId!);
  const boundary = "2026-11-01T00:00:00.000Z";
  pass.expiresAt = boundary;
  const clock = vi.spyOn(store, "now").mockReturnValue(boundary);
  expect(
    await (
      await post(`/payments/${payment.id}/refund`, { reason: "만료 경계" })
    ).json(),
  ).toMatchObject({ code: "PASS_EXPIRED" });
  expect(await (await get(`/passes/${pass.id}`)).json()).toMatchObject({
    status: "만료",
    canRefund: false,
  });
  clock.mockReturnValue("2026-10-31T23:59:59.999Z");
  const responses = await Promise.all([
    post(`/payments/${payment.id}/refund`, { reason: "미사용" }),
    post(`/payments/${payment.id}/refund`, { reason: "미사용" }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  clock.mockRestore();
});

it("does not persist entered refund reasons or new-customer transactions, while preserving current session data", async () => {
  const payment = (await (
    await post("/payments", createBody)
  ).json()) as Payment;
  const privateReason = "환불메모 개인 연락처 01098765432";
  await post(`/payments/${payment.id}/refund`, { reason: privateReason });
  expect(store.get("payments", payment.id).reason).toBe(privateReason);
  const custom = store.add("members", "gangnam", {
    name: "입력 고객 비공개",
    email: "",
    phone: "01077778888",
    status: "정상",
    note: "",
    branchIds: ["gangnam"],
  });
  const customPayment = (await (
    await post("/payments", { ...createBody, customerId: custom.id })
  ).json()) as Payment;
  expect(store.db.payments.some((p) => p.id === customPayment.id)).toBe(true);
  const persisted = new MockStore(true);
  persisted.db = store.db;
  persisted.persona = "owner";
  // The historical generic transaction store must not retain old payment
  // fingerprints/results containing a raw refund reason either.
  persisted.idempotency["old-payment"] = {
    fingerprint: privateReason,
    result: store.get("payments", payment.id),
    authorization: "fixture",
  };
  persisted.persist();
  const serialized = sessionStorage.getItem("openstudy-mock-v1")!;
  expect(serialized).not.toContain(privateReason);
  expect(serialized).not.toContain(custom.name);
  expect(serialized).not.toContain(customPayment.id);
  const reloaded = new MockStore(true);
  expect(
    reloaded.db.payments.every((p) =>
      reloaded.db.members.some((m) => m.id === p.memberId),
    ),
  ).toBe(true);
  expect(
    reloaded.db.passes.every((p) =>
      reloaded.db.members.some((m) => m.id === p.memberId),
    ),
  ).toBe(true);
  expect(store.get("payments", payment.id).reason).toBe(privateReason);
});
