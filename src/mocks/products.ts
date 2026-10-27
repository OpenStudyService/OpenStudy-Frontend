/** Contract fixtures for Backend #16 (pass products). The server remains the authority for every rule. */
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";

type Row = ResourceMap["products"];
type Category = ResourceMap["productCategories"];
type Snapshot = Row["history"][number]["after"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};

const UNIT_MAX = 4294967295;
const unit = z.number().int().min(1).max(UNIT_MAX);
const price = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ids = z
  .array(z.string().min(1))
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length, "중복된 지점입니다.");
const terms = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("시간권"),
      includedMinutes: unit,
      validDays: unit.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("기간권"), periodDays: unit }).strict(),
  z
    .object({
      kind: z.literal("정액권"),
      creditKrw: price,
      hourlyRateKrw: price,
      validDays: unit.nullable(),
    })
    .strict(),
]);
const status = z.enum(["판매 중", "판매 중지"]);
const name = z.string().trim().min(1).max(120);
const create = z
  .object({
    name,
    priceKrw: price,
    terms,
    status,
    categoryId: z.string().min(1),
    branchIds: ids,
  })
  .strict();
const update = z
  .object({
    version,
    name: name.optional(),
    priceKrw: price.optional(),
    terms: terms.optional(),
    categoryId: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 2, "변경할 값을 입력해 주세요.");
const categoryCreate = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "코드 형식이 아닙니다."),
    name,
    kind: z.enum(["시간권", "기간권", "정액권"]),
  })
  .strict();
const categoryUpdate = z
  .object({
    version,
    name: name.optional(),
    status: z.enum(["활성", "비활성"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 2, "변경할 값을 입력해 주세요.");

const active = (e: Employee, branchId: string) =>
  e.memberships.filter(
    (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
  );
const readable = (e: Employee, branchId: string) =>
  e.owner || active(e, branchId).length > 0;
const writable = (e: Employee, branchId: string) =>
  e.owner ||
  active(e, branchId).some((m) => m.permissions.includes("operations:write"));
const manager = (e: Employee, branchId: string) =>
  e.owner ||
  active(e, branchId).some(
    (m) => m.role === "admin" && m.permissions.includes("operations:write"),
  );
const deny = (message: string) => {
  throw new DomainError(403, "SCOPE_DENIED", message);
};
const visible = (e: Employee, p: Row) =>
  p.branchIds.some((id) => readable(e, id));

function categoryOf(id: string): Category {
  const row = store.db.productCategories.find((c) => c.id === id);
  if (!row)
    throw new DomainError(422, "VALIDATION_FAILED", "분류를 확인해 주세요.", {
      categoryId: "존재하지 않는 분류입니다.",
    });
  return row;
}
function product(id: string, actor: Employee): Row {
  const row = store.db.products.find((p) => p.id === id);
  assert(
    row && visible(actor, row),
    "상품을 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  return row;
}
const view = (actor: Employee, p: Row) => ({
  id: p.id,
  version: p.version,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  code: p.code,
  name: p.name,
  priceKrw: p.priceKrw,
  terms: p.terms,
  status: p.status,
  category: categoryOf(p.categoryId),
  branchIds: p.branchIds.filter((id) => readable(actor, id)),
  canEdit: p.branchIds.every((id) => writable(actor, id)),
});
function snapshot(p: Row): Snapshot {
  const category = categoryOf(p.categoryId);
  return structuredClone({
    schemaVersion: 1 as const,
    code: p.code,
    name: p.name,
    priceKrw: p.priceKrw,
    terms: p.terms,
    status: p.status,
    categoryCode: category.code,
    categoryName: category.name,
    branchIds: [...p.branchIds].sort(),
  });
}
function record(p: Row, actor: Employee, before: Snapshot | null) {
  const at = store.now();
  p.version += 1;
  p.updatedAt = at;
  p.history.push({
    id: `${p.id}-${p.version}`,
    version: p.version,
    changedAt: at,
    actorId: actor.id,
    changeType: "UPDATED",
    before,
    after: snapshot(p),
  });
}
function conflict(p: Row, expected: number) {
  if (p.version !== expected)
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "다른 사용자가 수정했습니다. 최신 내용을 확인해 주세요.",
      undefined,
      p.version,
      `/api/products/${p.id}`,
    );
}
const emit = (id: string, branchIds: string[]) =>
  [...new Set(branchIds)].forEach((b) =>
    store.emit("products", id, b, "changed"),
  );
function page<T>(request: Request, rows: T[]) {
  const q = new URL(request.url).searchParams;
  const number = Number(q.get("page") || 1),
    size = Number(q.get("pageSize") || 20);
  assert(
    Number.isInteger(number) &&
      number > 0 &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= 100,
    "페이지 범위를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return {
    items: rows.slice((number - 1) * size, number * size),
    meta: { page: number, pageSize: size, total: rows.length },
  };
}
function sorted<T extends { id: string }>(
  request: Request,
  rows: T[],
  keys: Record<string, (row: T) => string | number>,
  fallback = "createdAt",
) {
  const q = new URL(request.url).searchParams,
    sort = q.get("sort") || fallback,
    key = keys[sort];
  assert(key, "정렬 기준을 확인해 주세요.", 422, "VALIDATION_FAILED");
  const direction = q.get("direction") === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a),
      y = key(b);
    const c =
      typeof x === "number"
        ? x - (y as number)
        : String(x).localeCompare(String(y));
    return direction * (c || a.id.localeCompare(b.id));
  });
}
const response =
  (
    fn: (args: Args, actor: Employee) => unknown | Promise<unknown>,
    created = false,
  ) =>
  async (args: Args) => {
    try {
      const actor = store.activeUser();
      if (store.scenario === "error")
        throw new DomainError(
          503,
          "SERVICE_UNAVAILABLE",
          "시험 중인 일시적 서버 오류입니다.",
        );
      if (store.scenario === "forbidden")
        throw new DomainError(
          403,
          "SCOPE_DENIED",
          "이 요청에 대한 접근이 제한되었습니다.",
        );
      if (args.request.method !== "GET")
        assert(
          args.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json(
        (await fn(args, actor)) as Record<string, unknown>,
        {
          status: created ? 201 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? new DomainError(
              422,
              "VALIDATION_FAILED",
              "입력을 확인해 주세요.",
              Object.fromEntries(
                error.issues.flatMap((issue) =>
                  issue.code === "unrecognized_keys"
                    ? issue.keys.map((key) => [
                        key,
                        "허용되지 않은 필드입니다.",
                      ])
                    : [[issue.path.join(".") || "$body", issue.message]],
                ),
              ),
            )
          : error instanceof DomainError
            ? error
            : new DomainError(500, "MOCK_ERROR", (error as Error).message);
      return HttpResponse.json(
        {
          code: detail.code,
          message: detail.message,
          ...(detail.fieldErrors ? { fieldErrors: detail.fieldErrors } : {}),
          ...(detail.latestVersion === undefined
            ? {}
            : {
                latestVersion: detail.latestVersion,
                reloadUrl: detail.reloadUrl,
              }),
          requestId: crypto.randomUUID(),
        },
        { status: detail.status },
      );
    }
  };
const body = async <T extends z.ZodType>(schema: T, request: Request) =>
  schema.parse(await request.json()) as z.infer<T>;
const idempotencyKey = (request: Request) => {
  const key = request.headers.get("Idempotency-Key") || "";
  assert(
    key.length >= 16 && key.length <= 128,
    "멱등 키가 필요합니다.",
    422,
    "VALIDATION_FAILED",
  );
  return key;
};
const notAllowed = response(() => {
  throw new DomainError(
    405,
    "METHOD_NOT_ALLOWED",
    "삭제할 수 없습니다. 판매를 중지해 주세요.",
  );
});

export const productHandlers = [
  http.get(
    "/api/product-categories",
    response(({ request }) => {
      const q = new URL(request.url).searchParams,
        text = (q.get("q") || "").toLocaleLowerCase();
      return page(
        request,
        sorted(
          request,
          store.db.productCategories.filter(
            (c) =>
              (!q.get("kind") || c.kind === q.get("kind")) &&
              (!q.get("status") || c.status === q.get("status")) &&
              (!text ||
                [c.name, c.code].some((s) =>
                  s.toLocaleLowerCase().includes(text),
                )),
          ),
          {
            createdAt: (c) => c.createdAt,
            name: (c) => c.name,
            code: (c) => c.code,
          },
        ),
      );
    }),
  ),
  http.post(
    "/api/product-categories",
    response(async ({ request }, actor) => {
      if (!actor.owner) deny("분류 등록은 사장님만 할 수 있습니다.");
      const input = await body(categoryCreate, request);
      return store.transaction(idempotencyKey(request), input, () => {
        assert(
          !store.db.productCategories.some((c) => c.code === input.code),
          "이미 사용 중인 분류 코드입니다.",
          409,
          "CATEGORY_CODE_EXISTS",
        );
        const row = store.add("productCategories", "all", {
          ...input,
          status: "활성",
        });
        store.db.products.forEach((p) => emit(p.id, p.branchIds));
        return row;
      });
    }, true),
  ),
  http.patch(
    "/api/product-categories/:id",
    response(async ({ request, params }, actor) => {
      if (!actor.owner) deny("분류 변경은 사장님만 할 수 있습니다.");
      const input = await body(categoryUpdate, request);
      return store.transaction(undefined, input, () => {
        const row = store.db.productCategories.find(
          (c) => c.id === String(params.id),
        );
        assert(row, "분류를 찾을 수 없습니다.", 404, "NOT_FOUND");
        if (row.version !== input.version)
          throw new DomainError(
            409,
            "VERSION_CONFLICT",
            "다른 사용자가 수정했습니다. 최신 내용을 확인해 주세요.",
            undefined,
            row.version,
            `/api/product-categories/${row.id}`,
          );
        const next = {
          name: input.name ?? row.name,
          status: input.status ?? row.status,
        };
        if (next.name === row.name && next.status === row.status) return row;
        Object.assign(row, next, { updatedAt: store.now() });
        row.version += 1;
        store.db.products.forEach((p) => emit(p.id, p.branchIds));
        return row;
      });
    }),
  ),
  http.delete("/api/product-categories/:id", notAllowed),
  http.get(
    "/api/products",
    response(({ request }, actor) => {
      const q = new URL(request.url).searchParams,
        scope = q.get("scope") || "all",
        text = (q.get("q") || "").toLocaleLowerCase();
      assert(
        /^(all|[^/\s]+)$/.test(scope) &&
          (scope === "all" || readable(actor, scope)),
        "지점 권한이 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      const rows =
        store.scenario === "empty"
          ? []
          : store.db.products.filter(
              (p) =>
                visible(actor, p) &&
                (scope === "all" || p.branchIds.includes(scope)) &&
                (!q.get("status") || p.status === q.get("status")) &&
                (!q.get("kind") || p.terms.kind === q.get("kind")) &&
                (!q.get("categoryId") ||
                  p.categoryId === q.get("categoryId")) &&
                (!text ||
                  [p.name, p.code].some((s) =>
                    s.toLocaleLowerCase().includes(text),
                  )),
            );
      const result = page(
        request,
        sorted(request, rows, {
          createdAt: (p) => p.createdAt,
          name: (p) => p.name,
          priceKrw: (p) => p.priceKrw,
        }),
      );
      return { ...result, items: result.items.map((p) => view(actor, p)) };
    }),
  ),
  http.post(
    "/api/products",
    response(async ({ request }, actor) => {
      const input = await body(create, request);
      return store.transaction(idempotencyKey(request), input, () => {
        const category = categoryOf(input.categoryId);
        if (category.kind !== input.terms.kind || category.status !== "활성")
          throw new DomainError(
            422,
            "VALIDATION_FAILED",
            "분류를 확인해 주세요.",
            { categoryId: "같은 유형의 활성 분류를 선택해 주세요." },
          );
        input.branchIds.forEach((id) => {
          if (
            !store.db.branches.some((b) => b.id === id) ||
            !writable(actor, id)
          )
            deny("이 지점의 상품을 등록할 권한이 없습니다.");
        });
        const row = store.add("products", "all", {
          code: `P${store.db.products.length + 1}-${store.sequence}`,
          name: input.name,
          priceKrw: input.priceKrw,
          terms: input.terms,
          status: input.status,
          categoryId: input.categoryId,
          branchIds: [...input.branchIds],
          history: [],
        });
        row.history.push({
          id: `${row.id}-1`,
          version: 1,
          changedAt: row.createdAt,
          actorId: actor.id,
          changeType: "CREATED",
          before: null,
          after: snapshot(row),
        });
        emit(row.id, row.branchIds);
        return view(actor, row);
      });
    }, true),
  ),
  http.get(
    "/api/products/:id",
    response(({ params }, actor) =>
      view(actor, product(String(params.id), actor)),
    ),
  ),
  http.patch(
    "/api/products/:id",
    response(async ({ request, params }, actor) => {
      const input = await body(update, request);
      return store.transaction(undefined, input, () => {
        const row = product(String(params.id), actor);
        if (!row.branchIds.every((id) => writable(actor, id)))
          deny("공유 상품은 모든 판매 지점의 운영 변경 권한이 필요합니다.");
        conflict(row, input.version);
        if (input.terms && input.terms.kind !== row.terms.kind)
          throw new DomainError(
            422,
            "VALIDATION_FAILED",
            "상품 유형은 변경할 수 없습니다.",
            { "terms.kind": "상품 유형은 변경할 수 없습니다." },
          );
        if (input.categoryId && input.categoryId !== row.categoryId) {
          const category = categoryOf(input.categoryId);
          if (category.kind !== row.terms.kind || category.status !== "활성")
            throw new DomainError(
              422,
              "VALIDATION_FAILED",
              "분류를 확인해 주세요.",
              { categoryId: "같은 유형의 활성 분류를 선택해 주세요." },
            );
        }
        const before = snapshot(row);
        const next = {
          name: input.name ?? row.name,
          priceKrw: input.priceKrw ?? row.priceKrw,
          terms: input.terms ?? row.terms,
          categoryId: input.categoryId ?? row.categoryId,
        };
        const after = { ...row, ...next };
        if (JSON.stringify(snapshot(after as Row)) === JSON.stringify(before))
          return view(actor, row);
        Object.assign(row, next);
        record(row, actor, before);
        emit(row.id, row.branchIds);
        return view(actor, row);
      });
    }),
  ),
  http.delete("/api/products/:id", notAllowed),
  http.post(
    "/api/products/:id/status",
    response(async ({ request, params }, actor) => {
      const input = await body(z.object({ version, status }).strict(), request);
      return store.transaction(undefined, input, () => {
        const row = product(String(params.id), actor);
        if (!row.branchIds.every((id) => manager(actor, id)))
          deny("판매 상태는 모든 판매 지점의 지점 관리자만 바꿀 수 있습니다.");
        conflict(row, input.version);
        if (row.status === input.status) return view(actor, row);
        const before = snapshot(row);
        row.status = input.status;
        record(row, actor, before);
        emit(row.id, row.branchIds);
        return view(actor, row);
      });
    }),
  ),
  http.put(
    "/api/products/:id/branches",
    response(async ({ request, params }, actor) => {
      const input = await body(
        z.object({ version, branchIds: ids }).strict(),
        request,
      );
      return store.transaction(undefined, input, () => {
        const row = product(String(params.id), actor);
        const touched = [...row.branchIds, ...input.branchIds];
        if (
          !touched.every(
            (id) =>
              store.db.branches.some((b) => b.id === id) && manager(actor, id),
          )
        )
          deny("판매 지점은 관련 모든 지점의 지점 관리자만 바꿀 수 있습니다.");
        conflict(row, input.version);
        const next = [...input.branchIds].sort();
        if (JSON.stringify(next) === JSON.stringify([...row.branchIds].sort()))
          return view(actor, row);
        const before = snapshot(row);
        const previous = [...row.branchIds];
        row.branchIds = next;
        record(row, actor, before);
        emit(row.id, [...previous, ...next]);
        return view(actor, row);
      });
    }),
  ),
  http.get(
    "/api/products/:id/history",
    response(({ request, params }, actor) => {
      const row = product(String(params.id), actor);
      const touched = new Set([
        ...row.branchIds,
        ...row.history.flatMap((h) => [
          ...(h.before?.branchIds ?? []),
          ...h.after.branchIds,
        ]),
      ]);
      if (![...touched].every((id) => manager(actor, id)))
        deny("변경 이력은 관련 모든 지점의 지점 관리자만 볼 수 있습니다.");
      const sort = new URL(request.url).searchParams.get("sort");
      assert(
        !sort || sort === "changedAt",
        "정렬 기준을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      return page(
        request,
        sorted(
          request,
          row.history.map((h) => ({ ...h, productId: row.id })),
          { changedAt: (h) => h.version },
          "changedAt",
        ),
      );
    }),
  ),
];
