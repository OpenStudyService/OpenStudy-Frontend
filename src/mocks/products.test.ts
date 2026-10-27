import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { productHandlers } from "./products";
import { store } from "./store";

const server = setupServer(...productHandlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const request = (
  path: string,
  method = "GET",
  body?: object,
  key = crypto.randomUUID(),
) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const timeTerms = { kind: "시간권", includedMinutes: 600, validDays: null };
const input = (over: object = {}) => ({
  name: "10시간권",
  priceKrw: 15000,
  terms: timeTerms,
  status: "판매 중",
  categoryId: "cat-time",
  branchIds: ["gangnam"],
  ...over,
});
const created = async (over: object = {}) => {
  const response = await request("/products", "POST", input(over));
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    version: number;
    branchIds: string[];
  };
};

it("shows each user only readable branches and a per-product canEdit", async () => {
  const all = await (await request("/products")).json();
  expect(all.items).toHaveLength(3);
  expect(all.items.every((p: { canEdit: boolean }) => p.canEdit)).toBe(true);
  store.persona = "minji";
  const manager = await (await request("/products")).json();
  expect(manager.items[0].branchIds).toEqual(["gangnam"]);
  // A shared product is editable only with write access at every selling branch.
  expect(manager.items[0].canEdit).toBe(false);
  expect((await request("/products?scope=seongsu")).status).toBe(403);
});

it("registers a product with an initial revision and replays the same idempotency key", async () => {
  const key = crypto.randomUUID();
  const first = await request("/products", "POST", input(), key);
  const again = await request("/products", "POST", input(), key);
  expect(first.status).toBe(201);
  expect((await again.json()).id).toBe((await first.json()).id);
  expect(store.db.products).toHaveLength(4);
  const different = await request(
    "/products",
    "POST",
    input({ priceKrw: 1 }),
    key,
  );
  expect(different.status).toBe(409);
  const row = store.db.products.at(-1)!;
  expect(row.history).toHaveLength(1);
  expect(row.history[0]).toMatchObject({ version: 1, before: null });
});

it("rejects invalid terms, zero amounts, foreign fields and the wrong category kind", async () => {
  const bad = (over: object) => request("/products", "POST", input(over));
  expect((await bad({ priceKrw: 0 })).status).toBe(422);
  expect(
    (await bad({ terms: { ...timeTerms, includedMinutes: 0 } })).status,
  ).toBe(422);
  expect((await bad({ terms: { ...timeTerms, validDays: 0 } })).status).toBe(
    422,
  );
  expect((await bad({ terms: { ...timeTerms, periodDays: 30 } })).status).toBe(
    422,
  );
  expect(
    (await bad({ terms: { kind: "기간권", periodDays: 30, validDays: null } }))
      .status,
  ).toBe(422);
  expect((await bad({ categoryId: "cat-period" })).status).toBe(422);
  expect((await bad({ branchIds: [] })).status).toBe(422);
  expect((await bad({ unknown: true })).status).toBe(422);
  expect(store.db.products).toHaveLength(3);
});

it("rejects a branch outside the writer's grants and a shared product edit with partial access", async () => {
  store.persona = "minji";
  expect(
    (await request("/products", "POST", input({ branchIds: ["seongsu"] })))
      .status,
  ).toBe(403);
  const own = await created();
  expect(own.branchIds).toEqual(["gangnam"]);
  const shared = store.db.products[0];
  const response = await request(`/products/${shared.id}`, "PATCH", {
    version: shared.version,
    name: "x",
  });
  expect(response.status).toBe(403);
});

it("keeps unchanged requests free of new versions and refuses stale ones with the latest version", async () => {
  const product = await created();
  const same = await request(`/products/${product.id}`, "PATCH", {
    version: product.version,
    name: "10시간권",
  });
  expect((await same.json()).version).toBe(1);
  const changed = await request(`/products/${product.id}`, "PATCH", {
    version: 1,
    priceKrw: 16000,
  });
  expect((await changed.json()).version).toBe(2);
  const stale = await request(`/products/${product.id}`, "PATCH", {
    version: 1,
    priceKrw: 17000,
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "VERSION_CONFLICT",
    latestVersion: 2,
    reloadUrl: `/api/products/${product.id}`,
  });
  expect(store.get("products", product.id).priceKrw).toBe(16000);
});

it("forbids changing the product kind", async () => {
  const product = await created();
  const response = await request(`/products/${product.id}`, "PATCH", {
    version: 1,
    terms: { kind: "기간권", periodDays: 30 },
  });
  expect(response.status).toBe(422);
  expect((await response.json()).fieldErrors).toHaveProperty("terms.kind");
});

it("limits sale status, sale branches and history to branch managers and keeps before/after", async () => {
  const product = await created();
  await request(`/products/${product.id}`, "PATCH", {
    version: 1,
    priceKrw: 16000,
  });
  const stopped = await request(`/products/${product.id}/status`, "POST", {
    version: 2,
    status: "판매 중지",
  });
  expect((await stopped.json()).status).toBe("판매 중지");
  const moved = await request(`/products/${product.id}/branches`, "PUT", {
    version: 3,
    branchIds: ["gangnam", "seongsu"],
  });
  expect((await moved.json()).branchIds).toEqual(["gangnam", "seongsu"]);
  const history = await (
    await request(`/products/${product.id}/history`)
  ).json();
  expect(history.items.map((h: { version: number }) => h.version)).toEqual([
    4, 3, 2, 1,
  ]);
  expect(history.items[3].before).toBeNull();
  expect(history.items[1].before.priceKrw).toBe(16000);
  expect(history.items[1].before.status).toBe("판매 중");
  expect(history.items[1].after.status).toBe("판매 중지");
  // A writer without the branch-manager role may edit but not manage.
  store.get("employees", "junho").memberships[0].permissions = [
    "operations:write",
  ];
  store.persona = "junho";
  const own = store.db.products.at(-1)!;
  own.branchIds = ["gangnam"];
  expect(
    (
      await request(`/products/${own.id}/status`, "POST", {
        version: own.version,
        status: "판매 중",
      })
    ).status,
  ).toBe(403);
  expect((await request(`/products/${own.id}/history`)).status).toBe(403);
});

it("offers no delete route", async () => {
  const product = await created();
  expect((await request(`/products/${product.id}`, "DELETE")).status).toBe(405);
  expect(store.db.products).toHaveLength(4);
});

it("restricts category writes to the owner and never changes code or kind", async () => {
  const body = { code: "NIGHT", name: "야간", kind: "시간권" };
  expect((await request("/product-categories", "POST", body)).status).toBe(201);
  expect((await request("/product-categories", "POST", body)).status).toBe(409);
  const category = store.db.productCategories.at(-1)!;
  expect(
    (
      await request(`/product-categories/${category.id}`, "PATCH", {
        version: 1,
        kind: "기간권",
      })
    ).status,
  ).toBe(422);
  store.persona = "minji";
  expect(
    (await request("/product-categories", "POST", { ...body, code: "OTHER" }))
      .status,
  ).toBe(403);
  expect((await request("/product-categories")).status).toBe(200);
});
