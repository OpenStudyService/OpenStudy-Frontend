/** M4 contract handlers share the demo ledger with customers and seat usage. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";

type Payment = components["schemas"]["Payment"];
type Pass = components["schemas"]["Pass"];
type ProductTerms = components["schemas"]["ProductTerms"];
type PaymentRow = ResourceMap["payments"];
type PassRow = ResourceMap["passes"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
type Metadata = {
  productName: string;
  terms: ProductTerms;
  categoryName: string;
  method: Payment["method"];
  actor: Payment["createdBy"];
  refundActor?: Payment["createdBy"];
};
type State = {
  metadata: Map<string, Metadata>;
  accepted: Map<string, { fingerprint: string; result: Payment }>;
};
const states = new WeakMap<typeof store.events, State>();
function state() {
  let value = states.get(store.events);
  if (!value) {
    value = { metadata: new Map(), accepted: new Map() };
    states.set(store.events, value);
    for (const row of store.db.payments)
      if (row.productId && !row.reservationId) metadata(row, value);
  }
  return value;
}
function metadata(row: PaymentRow, value: State): Metadata {
  let saved = value.metadata.get(row.id);
  if (!saved) {
    const product = store.get("products", row.productId),
      category = store.get("productCategories", product.categoryId);
    saved = {
      productName: product.name,
      terms: structuredClone(product.terms),
      categoryName: category.name,
      method: row.method === "Mock 현금" ? "현금" : "카드",
      actor: { id: "owner", name: "김서연" },
    };
    value.metadata.set(row.id, saved);
  }
  return saved;
}
const paymentInput = z
  .object({
    customerId: z.string().min(1),
    branchId: z.string().min(1),
    productId: z.string().min(1),
    method: z.enum(["현금", "카드", "계좌이체", "기타"]),
    mockOutcome: z.enum(["APPROVED", "FAILED"]).default("APPROVED"),
  })
  .strict();
const refundInput = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
const customerSummary = (id: string) => {
  const customer = store.get("members", id);
  return {
    id,
    memberNo: customer.memberNo ?? `DEMO-${id}`,
    name: customer.name,
  };
};
function branches(actor: Employee, request: Request, paymentRead = false) {
  const scope = new URL(request.url).searchParams.get("scope") || "all";
  assert(
    scope === "all" || can(actor, scope),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  if (paymentRead)
    assert(
      can(actor, "all", "payments:read"),
      "결제 조회 권한이 없습니다.",
      403,
      "FORBIDDEN",
    );
  return store.db.branches
    .filter(
      (b) =>
        (scope === "all" || b.id === scope) &&
        can(actor, b.id, paymentRead ? "payments:read" : undefined),
    )
    .map((b) => b.id);
}
function effective(row: PassRow): Pass["status"] {
  if (row.status === "환불") return "환불";
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.parse(store.now()))
    return "만료";
  if (row.kind !== "기간권" && row.remaining <= 0) return "소진";
  return "활성";
}
const used = (row: PassRow) =>
  row.used || store.db.usage.some((u) => u.passId === row.id);
const refundable = (actor: Employee, row: PassRow) =>
  can(actor, row.branchId, "payments:write") &&
  !used(row) &&
  effective(row) === "활성" &&
  store.get("payments", row.paymentId).status === "승인";
function passView(actor: Employee, row: PassRow): Pass {
  const saved = metadata(store.get("payments", row.paymentId), state());
  return {
    id: row.id,
    version: row.version,
    customer: customerSummary(row.memberId),
    kind: row.kind,
    productId: row.productId,
    productName: saved.productName,
    categoryName: saved.categoryName,
    terms: structuredClone(saved.terms),
    remainingMinutes: row.kind === "시간권" ? row.remaining : null,
    remainingCreditKrw: row.kind === "정액권" ? row.remaining : null,
    status: effective(row),
    startedAt: row.createdAt,
    expiresAt: row.expiresAt || null,
    purchaseBranchId: row.branchId,
    purchasePaymentId: row.paymentId,
    createdAt: row.createdAt,
    used: used(row),
    canRefund: refundable(actor, row),
  };
}
function paymentView(actor: Employee, row: PaymentRow): Payment {
  const saved = metadata(row, state()),
    pass = store.db.passes.find((p) => p.paymentId === row.id);
  return {
    id: row.id,
    version: row.version,
    mock: true,
    purpose: "이용권",
    branchId: row.branchId,
    customer: customerSummary(row.memberId),
    productId: row.productId,
    productName: saved.productName,
    method: saved.method,
    amountKrw: row.amount,
    status: row.status,
    approvedAt: row.approvedAt || null,
    failedAt: row.status === "실패" ? row.createdAt : null,
    createdAt: row.createdAt,
    createdBy: saved.actor,
    passId: pass?.id ?? null,
    canRefund: !!pass && refundable(actor, pass),
    refund: row.refundAt
      ? {
          id: `refund-${row.id}`,
          amountKrw: row.amount,
          reason: row.reason,
          refundedAt: row.refundAt,
          processingBranchId: row.refundBranchId,
          processedBy: saved.refundActor ?? saved.actor,
        }
      : null,
  };
}
function page<T>(request: Request, rows: T[]) {
  const params = new URL(request.url).searchParams,
    page = Number(params.get("page") || 1),
    pageSize = Number(params.get("pageSize") || 20);
  assert(
    Number.isSafeInteger(page) &&
      page > 0 &&
      Number.isInteger(pageSize) &&
      pageSize > 0 &&
      pageSize <= 100,
    "페이지를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: rows.length },
  };
}
function sorted<T>(
  request: Request,
  rows: T[],
  keys: Record<string, (row: T) => string | number>,
) {
  const params = new URL(request.url).searchParams,
    key = keys[params.get("sort") || "createdAt"],
    direction = params.get("direction") || "desc";
  assert(
    Object.hasOwn(keys, params.get("sort") || "createdAt") &&
      ["asc", "desc"].includes(direction),
    "정렬 조건을 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return rows.sort((a, b) => {
    const x = key(a),
      y = key(b);
    return (
      (typeof x === "number" ? x - (y as number) : x.localeCompare(String(y))) *
      (direction === "asc" ? 1 : -1)
    );
  });
}
function replay(
  actor: Employee,
  request: Request,
  scope: string,
  body: object,
  task: () => Payment,
) {
  const key = request.headers.get("Idempotency-Key");
  assert(
    key && key.length >= 16 && key.length <= 128,
    "멱등 키를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  const value = state(),
    scoped = JSON.stringify([
      actor.id,
      new URL(request.url).pathname,
      scope,
      key,
    ]),
    fingerprint = JSON.stringify(body),
    prior = value.accepted.get(scoped);
  if (prior) {
    assert(
      prior.fingerprint === fingerprint,
      "같은 키에 다른 입력을 보낼 수 없습니다.",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    return structuredClone(prior.result);
  }
  const result = task();
  value.accepted.set(scoped, { fingerprint, result: structuredClone(result) });
  return result;
}
const response =
  (
    task: (args: Args, actor: Employee) => unknown | Promise<unknown>,
    status = 200,
  ) =>
  async (args: Args) => {
    try {
      const actorId = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const actor = store.activeUser();
      assert(
        actor.id === actorId,
        "계정이 변경되었습니다.",
        403,
        "AUTHORIZATION_CHANGED",
      );
      assert(
        store.scenario !== "error",
        "일시적 서버 오류입니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "접근 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (args.request.method !== "GET")
        assert(
          args.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      const result = await task(args, actor);
      return HttpResponse.json(result as Record<string, unknown>, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const failure =
        error instanceof z.ZodError
          ? new DomainError(
              422,
              "VALIDATION_FAILED",
              "입력을 확인해 주세요.",
              Object.fromEntries(
                error.issues.map((i) => [
                  i.path.join(".") || "body",
                  i.message,
                ]),
              ),
            )
          : error instanceof DomainError
            ? error
            : new DomainError(500, "MOCK_ERROR", "요청을 처리하지 못했습니다.");
      return HttpResponse.json(
        {
          code: failure.code,
          message: failure.message,
          ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
          requestId: crypto.randomUUID(),
        },
        { status: failure.status },
      );
    }
  };

export const paymentHandlers = [
  http.get(
    "/api/payments",
    response(({ request }, actor) => {
      const selected = branches(actor, request, true),
        q = new URL(request.url).searchParams,
        status = q.get("status"),
        from = q.get("from"),
        to = q.get("to");
      if (status) z.enum(["승인", "실패", "환불"]).parse(status);
      for (const date of [from, to])
        if (date) z.iso.datetime({ offset: true }).parse(date);
      assert(
        !from || !to || Date.parse(from) < Date.parse(to),
        "기간을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const rows =
        store.scenario === "empty"
          ? []
          : store.db.payments
              .filter(
                (p) =>
                  !!p.productId &&
                  !p.reservationId &&
                  selected.includes(p.branchId) &&
                  (!status || p.status === status) &&
                  (!q.get("customerId") ||
                    p.memberId === q.get("customerId")) &&
                  (!from || Date.parse(p.createdAt) >= Date.parse(from)) &&
                  (!to || Date.parse(p.createdAt) < Date.parse(to)),
              )
              .map((p) => paymentView(actor, p));
      return page(
        request,
        sorted(request, rows, {
          createdAt: (p) => p.createdAt,
          amountKrw: (p) => p.amountKrw,
        }),
      );
    }),
  ),
  http.get(
    "/api/payments/:id",
    response(({ request, params }, actor) => {
      const selected = branches(actor, request, true),
        row = store.db.payments.find(
          (p) =>
            p.id === params.id &&
            !!p.productId &&
            !p.reservationId &&
            selected.includes(p.branchId),
        );
      assert(row, "결제를 찾을 수 없습니다.", 404, "NOT_FOUND");
      return paymentView(actor, row);
    }),
  ),
  http.post(
    "/api/payments",
    response(async ({ request }, actor) => {
      const body = paymentInput.parse(await request.json());
      assert(
        can(actor, body.branchId, "payments:write"),
        "결제 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return replay(actor, request, body.branchId, body, () => {
        const branch = store.get("branches", body.branchId),
          customer = store.get("members", body.customerId),
          product = store.get("products", body.productId);
        assert(
          branch.status === "운영 중",
          "운영 중지 지점입니다.",
          409,
          "BRANCH_NOT_ACTIVE",
        );
        const related = [
          customer.registeredBranchId ?? customer.branchId,
          ...store.db.payments
            .filter((p) => p.memberId === customer.id)
            .map((p) => p.branchId),
        ];
        assert(
          actor.owner || related.some((id) => can(actor, id)),
          "고객을 찾을 수 없습니다.",
          404,
          "NOT_FOUND",
        );
        assert(
          customer.status === "정상",
          "정상 고객만 결제할 수 있습니다.",
          409,
          "CUSTOMER_NOT_ACTIVE",
        );
        assert(
          product.branchIds.some((id) => can(actor, id)),
          "상품을 찾을 수 없습니다.",
          404,
          "NOT_FOUND",
        );
        assert(
          product.status === "판매 중",
          "판매 중지 상품입니다.",
          409,
          "PRODUCT_NOT_ON_SALE",
        );
        assert(
          product.branchIds.includes(body.branchId),
          "해당 지점에서 판매하지 않는 상품입니다.",
          409,
          "PRODUCT_NOT_AVAILABLE_AT_BRANCH",
        );
        const approved = body.mockOutcome === "APPROVED",
          now = store.now(),
          row = store.add("payments", body.branchId, {
            memberId: customer.id,
            productId: product.id,
            reservationId: "",
            amount: product.priceKrw,
            method: body.method === "현금" ? "Mock 현금" : "Mock 카드",
            status: approved ? "승인" : "실패",
            approvedAt: approved ? now : "",
            refundAt: "",
            refundBranchId: "",
            reason: "",
          });
        state().metadata.set(row.id, {
          productName: product.name,
          terms: structuredClone(product.terms),
          categoryName: store.get("productCategories", product.categoryId).name,
          method: body.method,
          actor: { id: actor.id, name: actor.name },
        });
        if (approved) {
          const terms = product.terms,
            days = terms.kind === "기간권" ? terms.periodDays : terms.validDays;
          const pass = store.add("passes", body.branchId, {
            memberId: customer.id,
            productId: product.id,
            name: product.name,
            kind: terms.kind,
            remaining:
              terms.kind === "시간권"
                ? terms.includedMinutes
                : terms.kind === "정액권"
                  ? terms.creditKrw
                  : 0,
            hourlyRate: terms.kind === "정액권" ? terms.hourlyRateKrw : 0,
            expiresAt:
              days === null
                ? ""
                : new Date(Date.parse(now) + days * 86400000).toISOString(),
            used: false,
            paymentId: row.id,
            status: "활성",
          });
          pass.createdAt = now;
          store.emit("passes", pass.id, body.branchId);
        }
        store.emit("payments", row.id, body.branchId);
        return paymentView(actor, row);
      });
    }, 201),
  ),
  http.post(
    "/api/payments/:id/refund",
    response(async ({ request, params }, actor) => {
      const body = refundInput.parse(await request.json()),
        row = store.db.payments.find((p) => p.id === params.id);
      assert(
        row && can(actor, row.branchId),
        "결제를 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      assert(
        can(actor, row.branchId, "payments:write"),
        "원결제 지점 결제 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return replay(actor, request, row.id, body, () => {
        assert(
          row.status !== "환불",
          "이미 환불된 결제입니다.",
          409,
          "ALREADY_REFUNDED",
        );
        assert(
          row.status === "승인",
          "승인 결제만 환불할 수 있습니다.",
          409,
          "PAYMENT_NOT_REFUNDABLE",
        );
        const pass = store.db.passes.find((p) => p.paymentId === row.id);
        assert(pass, "이용권을 찾을 수 없습니다.", 404, "NOT_FOUND");
        assert(
          !used(pass),
          "사용한 이용권은 환불할 수 없습니다.",
          409,
          "PASS_ALREADY_USED",
        );
        assert(
          !pass.expiresAt ||
            Date.parse(pass.expiresAt) > Date.parse(store.now()),
          "만료된 이용권입니다.",
          409,
          "PASS_EXPIRED",
        );
        const saved = metadata(row, state());
        saved.refundActor = { id: actor.id, name: actor.name };
        row.status = "환불";
        row.refundAt = store.now();
        row.refundBranchId = row.branchId;
        row.reason = body.reason;
        row.version += 1;
        pass.status = "환불";
        pass.version += 1;
        store.emit("payments", row.id, row.branchId);
        store.emit("passes", pass.id, row.branchId);
        return paymentView(actor, row);
      });
    }),
  ),
  http.get(
    "/api/passes",
    response(({ request }, actor) => {
      const selected = branches(actor, request),
        q = new URL(request.url).searchParams,
        status = q.get("status"),
        kind = q.get("kind");
      if (status) z.enum(["활성", "소진", "만료", "환불"]).parse(status);
      if (kind) z.enum(["시간권", "기간권", "정액권"]).parse(kind);
      const rows =
        store.scenario === "empty"
          ? []
          : store.db.passes
              .filter(
                (p) =>
                  selected.includes(p.branchId) &&
                  (!q.get("customerId") ||
                    p.memberId === q.get("customerId")) &&
                  (!status || effective(p) === status) &&
                  (!kind || p.kind === kind),
              )
              .map((p) => passView(actor, p));
      return page(
        request,
        sorted(request, rows, {
          createdAt: (p) => p.createdAt,
          expiresAt: (p) => p.expiresAt ?? "9999",
        }),
      );
    }),
  ),
  http.get(
    "/api/passes/:id",
    response(({ request, params }, actor) => {
      const selected = branches(actor, request),
        row = store.db.passes.find(
          (p) => p.id === params.id && selected.includes(p.branchId),
        );
      assert(row, "이용권을 찾을 수 없습니다.", 404, "NOT_FOUND");
      return passView(actor, row);
    }),
  ),
];
