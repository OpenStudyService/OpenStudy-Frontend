import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
import { store } from "./store";
import { formatBusinessDate } from "../shared/domain/format";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
function get(query = "", path = "/audit-events") {
  return fetch(
    new URL(`/api${path}${query ? "?" + query : ""}`, window.location.origin),
  );
}

it("returns the server's default Seoul period, latest-first items, meta, and no snapshots", async () => {
  const response = await get("pageSize=2");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const page = await response.json();
  expect(page.period).toEqual({
    from: "2026-10-11",
    to: formatBusinessDate(store.now()),
  });
  expect(page.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
  expect(page.items.map((item: { id: string }) => item.id)).toEqual(["3", "2"]);
  expect(page.items[0]).toMatchObject({ actor: null, branch: null });
  expect(page.items[0]).not.toHaveProperty("before");
  const second = await (await get("pageSize=2&page=2")).json();
  expect(second.items.map((item: { id: string }) => item.id)).toEqual(["1"]);
});

it.each([
  ["from=2026-10-17", "2026-10-17", "2026-10-23"],
  ["to=2026-10-17", "2026-10-11", "2026-10-17"],
  ["from=2026-01-01&to=2026-04-02", "2026-01-01", "2026-04-02"],
])(
  "fills missing dates and accepts the 92-day boundary for %s",
  async (query, from, to) => {
    const response = await get(query);
    expect(response.status).toBe(200);
    expect((await response.json()).period).toEqual({ from, to });
  },
);

it.each([
  ["from=2026-01-01&to=2026-04-03", "PERIOD_TOO_LONG"],
  ["from=2026-02-29", "VALIDATION_FAILED"],
  ["from=2026-11-11&to=2026-11-10", "VALIDATION_FAILED"],
  ["entityId=1", "VALIDATION_FAILED"],
  ["scope=all", "VALIDATION_FAILED"],
  ["sort=occurredAt", "VALIDATION_FAILED"],
  ["page=0", "VALIDATION_FAILED"],
  ["pageSize=101", "VALIDATION_FAILED"],
  ["result=UNKNOWN", "VALIDATION_FAILED"],
  ["page=1&page=2", "VALIDATION_FAILED"],
  ["action=", "VALIDATION_FAILED"],
  ["actorEmployeeId=missing", "VALIDATION_FAILED"],
])("rejects invalid queries %s", async (query, code) => {
  const response = await get(query);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    code,
    fieldErrors: expect.any(Object),
  });
});

it("matches every exact filter and applies request filtering within the selected period", async () => {
  const query = new URLSearchParams({
    entityType: "employee",
    entityId: "2",
    action: "PROFILE_UPDATED",
    actorEmployeeId: "owner",
    branchId: "gangnam",
    result: "SUCCESS",
    requestId: "mock-audit-request",
  });
  const response = await get(query.toString());
  expect((await response.json()).items).toMatchObject([
    { id: "1", hasChanges: true },
  ]);
  expect(
    (await (await get("requestId=mock-audit-request&from=2020-01-01")).json())
      .items,
  ).toEqual([]);
  expect((await (await get("action=profile_updated")).json()).items).toEqual(
    [],
  );
});

it.each(["minji", "junho"])(
  "requires OWNER before validating queries or looking up records for %s",
  async (persona) => {
    store.persona = persona;
    for (const path of [
      "/audit-events",
      "/audit-events/1",
      "/audit-events/missing",
      "/audit",
    ]) {
      const response = await get(
        path === "/audit-events" ? "scope=invalid" : "",
        path,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  },
);

it("adapts existing writers, masks snapshots recursively, and handles missing records", async () => {
  const event = store.add("audit", "gangnam", {
    actorId: "owner",
    resource: "employees",
    targetId: "junho",
    action: "UPDATE",
    before: JSON.stringify({
      profile: { phone: "010-1234-5678", apiToken: "fixture-secret" },
    }),
    after: JSON.stringify({
      nested: [{ password: "fixture-password", contact: "01098765432" }],
      value: "changed",
    }),
  });
  const search = await (
    await get("entityType=employees&entityId=junho&action=UPDATE")
  ).json();
  expect(search.items).toMatchObject([{ id: event.id, hasChanges: true }]);
  const response = await get("", `/audit-events/${event.id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    before: { profile: { phone: "***-****-5678", apiToken: "***" } },
    after: { nested: [{ password: "***", contact: "*******5432" }] },
  });
  expect(store.db.audit[0].before).toContain("010-1234-5678");
  expect((await get("", "/audit-events/999999")).status).toBe(404);
});
