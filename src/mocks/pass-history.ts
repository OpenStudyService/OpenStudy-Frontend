/** M5 reads and adjustments use the same demo pass/usage rows as M4 and seats. */
import { http } from "msw/http";
import { z } from "zod";
import { can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import type {
  CustomerHistory,
  HistoryEvent,
  PassAdjustment,
} from "../features/pass-history/model";
import type { Pass } from "../features/payments/model";
import { assert, DomainError, store } from "./store";
import { customer } from "./customers";
import { passView, paymentResponse } from "./payments";

type Usage = ResourceMap["usage"];
type State = {
  adjustments: HistoryEvent[];
  usageActors: Map<
    string,
    { actor: HistoryEvent["actor"]; reason: string | null }
  >;
  accepted: Map<string, { fingerprint: string; result: Pass }>;
};
const states = new WeakMap<typeof store.events, State>();
function state() {
  let value = states.get(store.events);
  if (!value) {
    value = { adjustments: [], usageActors: new Map(), accepted: new Map() };
    states.set(store.events, value);
  }
  return value;
}
export function recordUsage(row: Usage, actor: Employee, reason?: string) {
  state().usageActors.set(row.id, {
    actor: { id: actor.id, name: actor.name },
    reason: reason || null,
  });
}
const input = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    remainingMinutes: z.number().int().min(0).max(4294967295).optional(),
    remainingCreditKrw: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      [body.remainingMinutes, body.remainingCreditKrw, body.expiresAt].some(
        (v) => v !== undefined,
      ),
    { message: "조정할 항목이 필요해요." },
  );
function selection(request: Request, actor: Employee) {
  const scope = new URL(request.url).searchParams.get("scope") || "all";
  assert(
    scope === "all" || can(actor, scope),
    "지점 접근 권한이 없어요.",
    403,
    "FORBIDDEN",
  );
  return store.db.branches
    .filter((b) => (scope === "all" || b.id === scope) && can(actor, b.id))
    .map((b) => b.id);
}
export const passHistoryHandlers = [
  http.post(
    "/api/passes/:id/adjustments",
    paymentResponse(async ({ request, params }, actor) => {
      const body = input.parse(await request.json()) as PassAdjustment;
      const selected = selection(request, actor);
      const row = store.db.passes.find(
        (p) => p.id === params.id && selected.includes(p.branchId),
      );
      assert(row, "이용권을 찾을 수 없어요.", 404, "NOT_FOUND");
      assert(
        can(actor, row.branchId, "payments:write"),
        "구매 지점의 결제 권한이 필요해요.",
        403,
        "FORBIDDEN",
      );
      const key = request.headers.get("Idempotency-Key");
      assert(
        key && key.length >= 16 && key.length <= 128,
        "요청 키를 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const keyScope = JSON.stringify([actor.id, row.id, key]),
        fingerprint = JSON.stringify(body);
      const prior = state().accepted.get(keyScope);
      if (prior) {
        assert(
          prior.fingerprint === fingerprint,
          "같은 키에 다른 입력을 보낼 수 없어요.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(prior.result);
      }
      assert(
        body.remainingMinutes === undefined || row.kind === "시간권",
        "시간권만 분을 조정할 수 있어요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        body.remainingCreditKrw === undefined || row.kind === "정액권",
        "정액권만 금액을 조정할 수 있어요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        body.expiresAt !== null || row.kind !== "기간권",
        "기간권의 만료 일시는 필수예요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        !body.expiresAt ||
          Date.parse(body.expiresAt) > Date.parse(row.createdAt),
        "만료 일시는 시작보다 뒤여야 해요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        row.status !== "환불",
        "환불 이용권은 조정할 수 없어요.",
        409,
        "PASS_REFUNDED",
      );
      if (row.version !== body.version || store.scenario === "conflict")
        throw new DomainError(
          409,
          "VERSION_CONFLICT",
          "최신 이용권을 확인해 주세요.",
          undefined,
          row.version,
          `/api/passes/${row.id}`,
        );
      const amount =
        body.remainingMinutes ?? body.remainingCreditKrw ?? row.remaining;
      const expiry =
        body.expiresAt === undefined ? row.expiresAt : body.expiresAt || "";
      if (
        amount !== row.remaining ||
        (expiry ? Date.parse(expiry) : null) !==
          (row.expiresAt ? Date.parse(row.expiresAt) : null)
      ) {
        state().adjustments.push({
          at: store.now(),
          type: "조정",
          passId: row.id,
          productName: passView(actor, row).productName,
          branchId: row.branchId,
          deltaMinutes: row.kind === "시간권" ? amount - row.remaining : 0,
          deltaKrw: row.kind === "정액권" ? amount - row.remaining : 0,
          usedMinutes: null,
          paymentId: null,
          seatSessionId: null,
          reason: body.reason,
          actor: { id: actor.id, name: actor.name },
        });
        row.remaining = amount;
        row.expiresAt = expiry;
        row.status = row.kind !== "기간권" && amount === 0 ? "소진" : "활성";
        row.version++;
        row.updatedAt = store.now();
        store.emit("passes", row.id, row.branchId);
      }
      const result = passView(actor, row);
      state().accepted.set(keyScope, {
        fingerprint,
        result: structuredClone(result),
      });
      return result;
    }),
  ),
  http.get(
    "/api/customers/:id/pass-history",
    paymentResponse(({ request, params }, actor): CustomerHistory => {
      const member = customer(actor, request, String(params.id)),
        selected = selection(request, actor);
      const query = new URL(request.url).searchParams;
      const from = query.get("from"),
        to = query.get("to");
      for (const value of [from, to])
        if (value !== null) z.iso.datetime({ offset: true }).parse(value);
      assert(
        !from || !to || Date.parse(from) < Date.parse(to),
        "조회 기간을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const passes: CustomerHistory["passes"] = [],
        events: HistoryEvent[] = [];
      for (const row of store.db.passes.filter(
        (p) => p.memberId === member.id && selected.includes(p.branchId),
      )) {
        const pass = passView(actor, row),
          payment = store.get("payments", row.paymentId);
        const terms = pass.terms as {
          includedMinutes?: number;
          creditKrw?: number;
        };
        const issued =
          row.kind === "시간권"
            ? (terms.includedMinutes ?? 0)
            : row.kind === "정액권"
              ? (terms.creditKrw ?? 0)
              : 0;
        const usage = store.db.usage.filter(
          (u) => u.passId === row.id && u.status === "완료",
        );
        const adjustments = state().adjustments.filter(
          (e) => e.passId === row.id,
        );
        const used = usage.reduce((sum, u) => sum + u.charged, 0),
          adjusted = adjustments.reduce(
            (sum, e) =>
              sum + (row.kind === "시간권" ? e.deltaMinutes : e.deltaKrw),
            0,
          );
        const imported =
          row.kind === "기간권" ? 0 : row.remaining - issued + used - adjusted;
        const common = {
          passId: row.id,
          productName: pass.productName,
          branchId: row.branchId,
          usedMinutes: null,
          deltaMinutes: 0,
          deltaKrw: 0,
          paymentId: null,
          seatSessionId: null,
          reason: null,
          actor: null,
        };
        events.push({
          ...common,
          type: "구매",
          at: payment.approvedAt || row.createdAt,
          paymentId: payment.id,
        });
        // Old synthetic fixtures predate the event ledger. Make the imported
        // opening balance explicit rather than inventing a purchase/use event.
        if (imported)
          events.push({
            ...common,
            type: "조정",
            at: row.createdAt,
            deltaMinutes: row.kind === "시간권" ? imported : 0,
            deltaKrw: row.kind === "정액권" ? imported : 0,
            reason: "초기 데모 잔량 이관",
          });
        events.push(...adjustments);
        for (const u of usage) {
          const inScope = selected.includes(u.branchId),
            saved = state().usageActors.get(u.id);
          events.push({
            ...common,
            type: "이용",
            at: u.endedAt,
            branchId: u.branchId,
            deltaMinutes: row.kind === "시간권" ? -u.charged : 0,
            deltaKrw: row.kind === "정액권" ? -u.charged : 0,
            usedMinutes: inScope ? u.minutes : null,
            seatSessionId: inScope ? u.id : null,
            reason: inScope ? (saved?.reason ?? null) : null,
            actor: inScope ? (saved?.actor ?? null) : null,
          });
        }
        if (payment.refundAt)
          events.push({
            ...common,
            type: "환불",
            at: payment.refundAt,
            paymentId: payment.id,
            reason: payment.reason,
          });
        const ledger = -used + adjusted + imported;
        passes.push({
          passId: row.id,
          kind: row.kind,
          productName: pass.productName,
          status: pass.status,
          purchaseBranchId: row.branchId,
          issuedMinutes: row.kind === "시간권" ? issued : null,
          issuedCreditKrw: row.kind === "정액권" ? issued : null,
          ledgerMinutes: row.kind === "시간권" ? ledger : 0,
          ledgerKrw: row.kind === "정액권" ? ledger : 0,
          remainingMinutes: pass.remainingMinutes,
          remainingCreditKrw: pass.remainingCreditKrw,
        });
      }
      const order = { 구매: 0, 이용: 1, 조정: 2, 환불: 3 };
      return {
        customer: {
          id: member.id,
          name: member.name,
          memberNo: member.memberNo ?? `DEMO-${member.id}`,
        },
        from,
        to,
        passes,
        events: events
          .filter(
            (e) =>
              (!from || Date.parse(e.at) >= Date.parse(from)) &&
              (!to || Date.parse(e.at) < Date.parse(to)),
          )
          .sort(
            (a, b) =>
              a.at.localeCompare(b.at) ||
              order[a.type] - order[b.type] ||
              a.passId.localeCompare(b.passId),
          ),
      };
    }),
  ),
];
