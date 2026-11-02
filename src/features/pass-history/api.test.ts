import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
import { api } from "../../shared/api/client";
import { getCustomerHistory, adjustPass } from "./api";
const request = vi.mocked(api);
beforeEach(() => request.mockReset());
const event = {
  at: "2026-11-02T00:00:00Z",
  type: "조정",
  passId: "p",
  productName: "시간권",
  deltaMinutes: 100,
  deltaKrw: 0,
  usedMinutes: null,
  branchId: "b",
  paymentId: null,
  seatSessionId: null,
  reason: "보정",
  actor: { id: "owner", name: "관리자" },
};
const ledger = {
  passId: "p",
  kind: "시간권",
  productName: "시간권",
  status: "활성",
  purchaseBranchId: "b",
  issuedMinutes: 600,
  issuedCreditKrw: null,
  ledgerMinutes: 100,
  ledgerKrw: 0,
  remainingMinutes: 700,
  remainingCreditKrw: null,
};
const history = {
  customer: { id: "c", name: "고객", memberNo: "M001" },
  from: null,
  to: null,
  events: [event],
  passes: [ledger],
};
it("uses encoded IDs and scoped UTC bounds, accepts implemented nullable refs, and strips extra fields", async () => {
  request.mockResolvedValue({
    ...history,
    secret: "omit",
    events: [{ ...event, amountKrw: 9000 }],
  });
  const response = await getCustomerHistory("c", "b", {
    from: "2026-11-02T00:00:00Z",
    to: "2026-11-03T00:00:00Z",
  });
  expect(request.mock.calls[0][0]).toContain(
    "/customers/c/pass-history?scope=b&from=2026-11-02T00%3A00%3A00Z",
  );
  expect(response.events[0]).not.toHaveProperty("amountKrw");
  expect(response).not.toHaveProperty("secret");
});
it.each([
  { ...history, customer: { ...history.customer, id: "other" } },
  { ...history, passes: [{ ...ledger, purchaseBranchId: "other" }] },
  { ...history, events: [{ ...event, passId: "other" }] },
  { ...history, events: [{ ...event, deltaMinutes: "100" }] },
])("rejects mismatched or malformed history", async (value) => {
  request.mockResolvedValue(value);
  await expect(getCustomerHistory("c", "b", {})).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
});
it("enforces the exclusive period end", async () => {
  request.mockResolvedValue(history);
  await expect(
    getCustomerHistory("c", "b", { to: event.at }),
  ).rejects.toThrow();
});
it("sends only adjustment fields with a key, signal, purchase scope and explicit null", async () => {
  const pass = {
    id: "p/a",
    version: 4,
    kind: "시간권",
    status: "활성",
    purchaseBranchId: "b",
    remainingMinutes: 700,
    remainingCreditKrw: null,
    expiresAt: null,
  };
  request.mockResolvedValue(pass);
  const signal = new AbortController().signal;
  await adjustPass(
    "p/a",
    "b",
    { version: 3, reason: "fix", expiresAt: null },
    signal,
    "request-key",
  );
  expect(request).toHaveBeenCalledWith(
    "/passes/p%2Fa/adjustments?scope=b",
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({ version: 3, expiresAt: null }),
      signal,
      key: "request-key",
    }),
  );
});
