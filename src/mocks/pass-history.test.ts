import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { passHistoryHandlers } from "./pass-history";
import { paymentHandlers } from "./payments";
import { seatHandlers } from "./seats";
import { store } from "./store";
const server = setupServer(
  ...passHistoryHandlers,
  ...paymentHandlers,
  ...seatHandlers,
);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const get = (path: string) =>
  fetch(new URL(`/api${path}`, window.location.origin));
const post = (path: string, body: object, key = crypto.randomUUID()) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
async function issued(product = "time100") {
  const payment = await (
    await post("/payments", {
      customerId: "member-1",
      branchId: "gangnam",
      productId: product,
      method: "카드",
      mockOutcome: "APPROVED",
    })
  ).json();
  expect(payment.passId).toBeTruthy();
  return await (await get(`/passes/${payment.passId}`)).json();
}
it("adjusts once per key, maintains ledger equality and does not filter whole-ledger totals by date", async () => {
  const pass = await issued(),
    key = crypto.randomUUID(),
    reason = "정정 사유 비공개";
  const body = { version: pass.version, remainingMinutes: 0, reason };
  const first = await post(
    `/passes/${pass.id}/adjustments?scope=gangnam`,
    body,
    key,
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    remainingMinutes: 0,
    status: "소진",
  });
  expect(
    (await post(`/passes/${pass.id}/adjustments?scope=gangnam`, body, key))
      .status,
  ).toBe(200);
  expect(
    (
      await post(
        `/passes/${pass.id}/adjustments`,
        { ...body, remainingMinutes: 1 },
        key,
      )
    ).status,
  ).toBe(409);
  const history = await (
    await get("/customers/member-1/pass-history?scope=gangnam")
  ).json();
  expect(
    history.events.filter((e: { reason: string }) => e.reason === reason),
  ).toHaveLength(1);
  const ledger = history.passes.find(
    (p: { passId: string }) => p.passId === pass.id,
  );
  expect(ledger.issuedMinutes + ledger.ledgerMinutes).toBe(
    ledger.remainingMinutes,
  );
  const filtered = await (
    await get(
      "/customers/member-1/pass-history?scope=gangnam&from=2099-01-01T00:00:00Z",
    )
  ).json();
  expect(filtered.events).toHaveLength(0);
  expect(filtered.passes).toEqual(history.passes);
  expect(
    (
      await post(`/passes/${pass.id}/adjustments`, {
        version: pass.version,
        remainingMinutes: 1,
        reason,
      })
    ).status,
  ).toBe(409);
  const current = await (await get(`/passes/${pass.id}`)).json();
  expect(
    (
      await post(`/passes/${pass.id}/adjustments`, {
        version: current.version,
        remainingMinutes: 50,
        reason,
      })
    ).status,
  ).toBe(200);
});
it("checks purchase-branch write permission and refuses refunded passes", async () => {
  const pass = await issued();
  store.persona = "junho";
  expect(
    (
      await post(`/passes/${pass.id}/adjustments`, {
        version: pass.version,
        remainingMinutes: 1,
        reason: "no",
      })
    ).status,
  ).toBe(403);
  store.persona = "owner";
  expect(
    (
      await post(`/payments/${pass.purchasePaymentId}/refund`, {
        reason: "환불",
      })
    ).status,
  ).toBe(200);
  const latest = await (await get(`/passes/${pass.id}`)).json();
  expect(
    (
      await post(`/passes/${pass.id}/adjustments`, {
        version: latest.version,
        remainingMinutes: 1,
        reason: "no",
      })
    ).status,
  ).toBe(409);
});
it("returns scoped customer history, redacts cross-branch usage and excludes running usage events", async () => {
  const pass = await issued();
  const usage = store.db.usage[0];
  usage.passId = pass.id;
  usage.memberId = "member-1";
  usage.branchId = "seongsu";
  usage.status = "완료";
  usage.endedAt = store.now();
  const response = await get("/customers/member-1/pass-history?scope=gangnam");
  expect(response.status).toBe(200);
  const history = await response.json();
  const event = history.events.find(
    (e: { passId: string; type: string }) =>
      e.passId === pass.id && e.type === "이용",
  );
  expect(event).toMatchObject({
    branchId: "seongsu",
    actor: null,
    reason: null,
    usedMinutes: null,
    seatSessionId: null,
  });
  const bound = await get(
    "/customers/member-1/pass-history?from=2026-11-02T00:00:00Z&to=2026-11-02T00:00:00Z",
  );
  expect(bound.status).toBe(422);
});
it("validates type-specific adjustments, reason, expiry and CSRF", async () => {
  const pass = await issued();
  for (const patch of [
    { remainingMinutes: -1 },
    { remainingMinutes: 1.5 },
    { remainingCreditKrw: 2 },
    { expiresAt: "2020-01-01T00:00:00Z" },
    {},
  ]) {
    expect(
      (
        await post(`/passes/${pass.id}/adjustments`, {
          version: pass.version,
          reason: "invalid",
          ...patch,
        })
      ).status,
    ).toBe(422);
  }
  expect(
    (
      await post(`/passes/${pass.id}/adjustments`, {
        version: pass.version,
        reason: "",
        remainingMinutes: 1,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await fetch(
        new URL(`/api/passes/${pass.id}/adjustments`, window.location.origin),
        { method: "POST", body: "{}" },
      )
    ).status,
  ).toBe(403);
});
