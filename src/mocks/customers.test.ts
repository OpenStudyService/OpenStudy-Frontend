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
import { customerHandlers } from "./customers";
import { store } from "./store";
import type { components } from "../shared/api/foundation.generated";

type Customer = components["schemas"]["Customer"];
const server = setupServer(...customerHandlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
function request(
  path: string,
  method = "GET",
  body?: object,
  key: string = crypto.randomUUID(),
  headers: Record<string, string> = {},
) {
  return fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const input = (over: object = {}) => ({
  registeredBranchId: "gangnam",
  name: "테스트 고객",
  phone: "010-1234-5678",
  email: "",
  memo: "",
  ...over,
});
async function created(over: object = {}) {
  const result = await request("/customers", "POST", input(over));
  expect(result.status).toBe(201);
  return (await result.json()) as Customer;
}
it("returns only search fields in lists and private values only in an authorized detail", async () => {
  const customer = await created({
    email: "private@example.test",
    memo: "상세 응대 메모",
  });
  const list = await (
    await request(`/customers?q=${encodeURIComponent(customer.memberNo)}`)
  ).json();
  expect(list.items).toHaveLength(1);
  expect(Object.keys(list.items[0]).sort()).toEqual([
    "id",
    "memberNo",
    "name",
    "phone",
    "registeredAt",
    "registeredBranchId",
    "status",
  ]);
  expect(list.items[0].phone).toBe("01012345678");
  expect(
    await (await request(`/customers/${customer.id}`)).json(),
  ).toMatchObject({
    email: "private@example.test",
    memo: "상세 응대 메모",
    canEdit: true,
  });
  store.persona = "doyun";
  expect((await request(`/customers/${customer.id}`)).status).toBe(404);
  const other = await (
    await request(`/customers?q=${encodeURIComponent(customer.memberNo)}`)
  ).json();
  expect(other.meta.total).toBe(0);
});
it("allows every active branch member to read, but never infers write permissions from membership or role", async () => {
  store.persona = "junho";
  expect((await request("/customers/member-1?scope=gangnam")).status).toBe(200);
  expect(await (await request("/customers/member-1")).json()).toMatchObject({
    canEdit: false,
  });
  expect((await request("/customers", "POST", input())).status).toBe(403);
  expect(
    (
      await request("/customers/member-1", "PATCH", {
        version: 1,
        name: "거부됨",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/customers/member-1/status", "POST", {
        version: 1,
        status: "비활성",
        reason: "권한 없음",
      })
    ).status,
  ).toBe(403);
  expect((await request("/customers?scope=seongsu")).status).toBe(403);
  store.user().memberships[0].status = "회수";
  expect((await request("/customers/member-1")).status).toBe(404);
  store.user().status = "이용 제한";
  expect((await request("/customers")).status).toBe(403);
});
it("uses registration and payment branches for visibility and any related write grant for editing", async () => {
  const customer = await created({ registeredBranchId: "seongsu" });
  store.persona = "minji";
  expect(
    (await request(`/customers/${customer.id}?scope=gangnam`)).status,
  ).toBe(404);
  store.db.payments.push({
    ...store.db.payments[0],
    id: "related-payment",
    memberId: customer.id,
    branchId: "gangnam",
    status: "환불",
  });
  expect(
    await (await request(`/customers/${customer.id}?scope=gangnam`)).json(),
  ).toMatchObject({ canEdit: true, registeredBranchId: "seongsu" });
  const changed = await request(
    `/customers/${customer.id}?scope=gangnam`,
    "PATCH",
    { version: customer.version, name: "결제 지점에서 변경" },
  );
  expect(changed.status).toBe(200);
  expect((await changed.json()).name).toBe("결제 지점에서 변경");
});
it("keeps unassigned legacy customers exclusive to OWNER in the all-branch scope", async () => {
  const row = store.db.members[0];
  row.registeredBranchId = null;
  store.db.payments = store.db.payments.filter((p) => p.memberId !== row.id);
  expect((await request(`/customers/${row.id}?scope=all`)).status).toBe(200);
  expect((await request(`/customers/${row.id}?scope=gangnam`)).status).toBe(
    404,
  );
  store.persona = "minji";
  expect((await request(`/customers/${row.id}?scope=all`)).status).toBe(404);
});
it("validates normalized input, immutable fields, stopped branches and required idempotency keys", async () => {
  expect(
    (await request("/customers", "POST", input({ phone: "123" }))).status,
  ).toBe(422);
  expect(
    (await request("/customers", "POST", input({ name: "x".repeat(101) })))
      .status,
  ).toBe(422);
  expect(
    (await request("/customers", "POST", input({ email: "bad" }))).status,
  ).toBe(422);
  expect(
    (await request("/customers", "POST", input({ memo: "x".repeat(1001) })))
      .status,
  ).toBe(422);
  expect((await request("/customers", "POST", input(), "")).status).toBe(422);
  const immutable = await request("/customers/member-1", "PATCH", {
    version: 1,
    registeredBranchId: "seongsu",
  });
  expect(immutable.status).toBe(422);
  expect((await immutable.json()).code).toBe("IMMUTABLE_FIELD");
  store.db.branches[0].status = "운영 중지";
  const stopped = await request("/customers", "POST", input());
  expect(stopped.status).toBe(409);
  expect((await stopped.json()).code).toBe("BRANCH_NOT_ACTIVE");
  expect((await request("/customers/member-1", "DELETE")).status).toBe(405);
});
it("replays normalized registration once in memory, rejects changed input, and never persists the request fingerprint", async () => {
  const key = crypto.randomUUID(),
    before = store.db.members.length;
  const first = await request("/customers", "POST", input(), key);
  const original = await first.json();
  const again = await request(
    "/customers",
    "POST",
    input({ phone: "01012345678", email: null, memo: null }),
    key,
  );
  expect(await again.json()).toEqual(original);
  expect(store.db.members).toHaveLength(before + 1);
  expect(Object.keys(store.idempotency)).toHaveLength(0);
  expect(
    (await request("/customers", "POST", input({ name: "다른 입력" }), key))
      .status,
  ).toBe(409);
  expect(() =>
    store.transaction(undefined, {}, () => {
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(
    (await (await request("/customers", "POST", input(), key)).json()).id,
  ).toBe(original.id);
  expect(store.db.members).toHaveLength(before + 1);
});
it("preserves independent fields on partial update and supplies a current-version conflict response", async () => {
  const customer = await created({
    email: "keep@example.test",
    memo: "기존 메모",
  });
  const response = await request(`/customers/${customer.id}`, "PATCH", {
    version: 1,
    name: "변경 이름",
  });
  expect(await response.json()).toMatchObject({
    name: "변경 이름",
    email: "keep@example.test",
    memo: "기존 메모",
    version: 2,
  });
  const stale = await request(`/customers/${customer.id}`, "PATCH", {
    version: 1,
    memo: "충돌 입력",
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "VERSION_CONFLICT",
    latestVersion: 2,
    reloadUrl: `/api/customers/${customer.id}`,
  });
  const unchanged = await request(`/customers/${customer.id}`, "PATCH", {
    version: 2,
    name: "변경 이름",
  });
  expect((await unchanged.json()).version).toBe(2);
  const cleared = await request(`/customers/${customer.id}`, "PATCH", {
    version: 2,
    memo: null,
    email: null,
  });
  expect(await cleared.json()).toMatchObject({
    email: null,
    memo: null,
    version: 3,
  });
  expect(
    store.db.audit
      .filter((a) => a.resource === "customers")
      .every(
        (a) =>
          !a.after.includes("keep@example.test") &&
          !a.after.includes("기존 메모") &&
          !a.after.includes("변경 이름"),
      ),
  ).toBe(true);
});
it("keeps new customer values and create idempotency fingerprints out of session storage", async () => {
  const key = crypto.randomUUID();
  const result = await request(
    "/customers",
    "POST",
    input({
      name: "비공개 신규 이름",
      phone: "01077778888",
      memo: "비공개 신규 메모",
    }),
    key,
  );
  const customer = (await result.json()) as Customer;
  expect(result.status).toBe(201);
  await request(`/customers/${customer.id}`, "PATCH", {
    version: 1,
    memo: "비공개 수정 메모",
  });
  await request(`/customers/${customer.id}/status`, "POST", {
    version: 2,
    status: "이용 제한",
    reason: "비공개 상태 사유",
  });
  const saved = sessionStorage.getItem("openstudy-mock-v1") ?? "";
  for (const value of [
    "비공개 신규 이름",
    "01077778888",
    "비공개 신규 메모",
    "비공개 수정 메모",
    "비공개 상태 사유",
    key,
  ])
    expect(saved).not.toContain(value);
  expect(
    await (await request(`/customers/${customer.id}`)).json(),
  ).toMatchObject({
    memo: "비공개 수정 메모",
    statusReason: "비공개 상태 사유",
  });
});
it("requires a status reason, records the previous status, and leaves no-op requests unchanged", async () => {
  const customer = await created();
  expect(
    (
      await request(`/customers/${customer.id}/status`, "POST", {
        version: 1,
        status: "이용 제한",
        reason: "",
      })
    ).status,
  ).toBe(422);
  const response = await request(`/customers/${customer.id}/status`, "POST", {
    version: 1,
    status: "이용 제한",
    reason: "응대 사유",
  });
  expect(await response.json()).toMatchObject({
    status: "이용 제한",
    statusReason: "응대 사유",
    version: 2,
  });
  const row = store.db.members.find((r) => r.id === customer.id)!;
  expect(row.statusEvents).toEqual([
    expect.objectContaining({
      before: "정상",
      after: "이용 제한",
      reason: "응대 사유",
      actorId: "owner",
    }),
  ]);
  const count = store.db.audit.length;
  await request(`/customers/${customer.id}/status`, "POST", {
    version: 2,
    status: "이용 제한",
    reason: "중복 요청",
  });
  expect(row.statusEvents).toHaveLength(1);
  expect(row.version).toBe(2);
  expect(store.db.audit).toHaveLength(count);
});
it("enforces search boundaries, ordering, pagination and the 100-row cap", async () => {
  const page = await (
    await request("/customers?page=2&pageSize=2&sort=name&direction=asc")
  ).json();
  expect(page.items).toHaveLength(2);
  expect(page.meta).toEqual({ page: 2, pageSize: 2, total: 6 });
  expect((await (await request("/customers?q=010")).json()).items).toHaveLength(
    0,
  );
  expect(
    (await (await request("/customers?q=2100")).json()).items,
  ).toHaveLength(1);
  expect(
    (await (await request("/customers?q=DEMO-member-1")).json()).items,
  ).toHaveLength(1);
  expect(
    (await (await request("/customers?q=DEMO-member-")).json()).items,
  ).toHaveLength(0);
  expect((await request("/customers?pageSize=101")).status).toBe(422);
  expect((await request("/customers?sort=phone")).status).toBe(422);
  expect((await request("/customers?direction=other")).status).toBe(422);
  expect((await request(`/customers?q=${"x".repeat(101)}`)).status).toBe(422);
});
it("distinguishes failed access, unauthenticated requests, CSRF and server failures from empty results", async () => {
  expect(
    (
      await request("/customers", "POST", input(), crypto.randomUUID(), {
        "X-CSRF-Token": "bad",
      })
    ).status,
  ).toBe(403);
  store.persona = null;
  expect((await request("/customers")).status).toBe(401);
  store.persona = "owner";
  store.scenario = "error";
  expect((await request("/customers")).status).toBe(503);
  store.scenario = "empty";
  expect(await (await request("/customers")).json()).toMatchObject({
    items: [],
    meta: { total: 0 },
  });
});

it("rejects a delayed read after its starting persona changes without disclosing the previous account's data", async () => {
  let begin!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const active = store.activeUser.bind(store);
  vi.spyOn(store, "activeUser").mockImplementation(() => {
    const actor = active();
    begin();
    return actor;
  });
  store.scenario = "slow";
  const pending = request("/customers/member-1");
  await started;
  store.persona = "doyun";
  const result = await pending;
  expect(result.status).toBe(403);
  expect(await result.json()).toMatchObject({ code: "AUTHORIZATION_CHANGED" });
});

it("rejects delayed registration after the account becomes restricted", async () => {
  let begin!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const active = store.activeUser.bind(store);
  vi.spyOn(store, "activeUser").mockImplementation(() => {
    const actor = active();
    begin();
    return actor;
  });
  store.scenario = "slow";
  const before = store.db.members.length;
  const pending = request("/customers", "POST", input());
  await started;
  store.user().status = "이용 제한";
  const result = await pending;
  expect(result.status).toBe(403);
  expect(await result.json()).toMatchObject({ code: "ACCOUNT_INACTIVE" });
  expect(store.db.members).toHaveLength(before);
});

it.each([
  ["/customers", "POST", input()],
  [
    "/customers/member-1",
    "PATCH",
    { version: 1, name: "반영되면 안 되는 이름" },
  ],
  [
    "/customers/member-1/status",
    "POST",
    { version: 1, status: "이용 제한", reason: "반영되면 안 되는 사유" },
  ],
])(
  "rechecks permissions after reading the body of %s %s",
  async (path, method, body) => {
    let begin!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const json = Request.prototype.json;
    vi.spyOn(Request.prototype, "json").mockImplementation(async function (
      this: Request,
    ) {
      const value: unknown = await json.call(this);
      if (this.url.includes("/api/customers") && this.method !== "GET") {
        begin();
        await gate;
      }
      return value;
    });
    store.persona = "minji";
    const before = structuredClone(store.db.members);
    const pending = request(path, method, body);
    await started;
    store.db.employees = store.db.employees.map((actor) =>
      actor.id === "minji"
        ? {
            ...actor,
            memberships: actor.memberships.map((membership) => ({
              ...membership,
              permissions: [],
            })),
          }
        : actor,
    );
    release();
    const result = await pending;
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(store.db.members).toEqual(before);
  },
);
