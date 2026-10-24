import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { organizationHandlers, organizationEmployee } from "./organization";
import { store } from "./store";
import { defaultHours } from "../features/organization/model";
import type {
  Employee,
  Membership,
  Preset,
} from "../features/organization/model";

const server = setupServer(...organizationHandlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const request = (path: string, method = "GET", body?: object) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const body = (employee: Employee, membership: Membership) => ({
  employeeVersion: employee.version,
  version: membership.version,
  status: "활성",
  role: "staff",
  permissions: [],
});

it("updates only one membership of a two-branch employee and rejects stale employee/membership versions", async () => {
  const row = store.get("employees", "junho");
  row.memberships.push({
    branchId: "seongsu",
    role: "staff",
    permissions: ["sales:read"],
  });
  const original = organizationEmployee(row),
    other = structuredClone(row.memberships[1]);
  const response = await request(
    "/employees/junho/memberships/gangnam?scope=all",
    "PUT",
    {
      ...body(original, original.memberships[0]),
      permissions: ["operations:write"],
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    employeeVersion: 2,
    membership: { version: 2, permissions: ["operations:write"] },
  });
  expect(row.memberships[1]).toEqual(other);
  const stale = await request(
    "/employees/junho/memberships/gangnam",
    "PUT",
    body(original, original.memberships[0]),
  );
  expect(stale.status).toBe(409);
  const current = organizationEmployee(row);
  expect(
    (
      await request("/employees/junho/memberships/gangnam", "PUT", {
        ...body(current, current.memberships[0]),
        version: 1,
      })
    ).status,
  ).toBe(409);
  expect(row.memberships[1]).toEqual(other);
});

it("lets managers edit local staff only and rejects direct forged owner/admin/self/cross-branch requests", async () => {
  store.persona = "minji";
  const staff = organizationEmployee(store.get("employees", "junho"));
  expect(
    (
      await request(
        "/employees/junho/memberships/gangnam?scope=gangnam",
        "PUT",
        { ...body(staff, staff.memberships[0]), role: "admin" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/employees/junho", "PATCH", {
        version: 1,
        name: "이름 변경",
      })
    ).status,
  ).toBe(403);
  for (const id of ["owner", "minji"]) {
    const target = organizationEmployee(store.get("employees", id));
    expect(
      (
        await request(
          `/employees/${id}/memberships/gangnam`,
          "PUT",
          body(target, target.memberships[0]),
        )
      ).status,
    ).toBe(403);
  }
  const other = organizationEmployee(store.get("employees", "yujin"));
  expect(
    (
      await request(
        "/employees/yujin/memberships/seongsu?scope=gangnam",
        "PUT",
        body(other, other.memberships[0]),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/branches", "POST", {
        name: "지점",
        address: "서울",
        phone: "02",
        status: "운영 중",
        weeklyHours: defaultHours(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/employees/junho/memberships/gangnam?scope=gangnam",
        "PUT",
        {
          ...body(staff, staff.memberships[0]),
          permissions: ["operations:write"],
        },
      )
    ).status,
  ).toBe(200);
  const listed = await (await request("/employees?scope=all")).json();
  expect(
    listed.items.every((e: Employee) =>
      e.memberships.every((m) => m.branchId === "gangnam"),
    ),
  ).toBe(true);
  expect(listed.meta.total).toBe(3);
});

it("requires explicit manager grants and denies staff even with a forged people grant", async () => {
  store.persona = "minji";
  store.user().memberships[0].permissions = [];
  expect((await request("/employees")).status).toBe(403);
  expect(
    (
      await request("/branches/gangnam", "PATCH", {
        version: 1,
        name: "새 이름",
      })
    ).status,
  ).toBe(403);
  store.persona = "junho";
  store.user().memberships[0].permissions = ["people:manage"];
  expect((await request("/employees")).status).toBe(403);
  expect((await request("/permission-presets")).status).toBe(403);
});

it("preserves other branches on revoke and requires reinvitation to restore the revoked membership", async () => {
  const row = store.get("employees", "junho");
  row.memberships.push({ branchId: "seongsu", role: "staff", permissions: [] });
  const old = organizationEmployee(row);
  expect(
    (
      await request("/employees/junho/memberships/gangnam", "PUT", {
        ...body(old, old.memberships[0]),
        status: "회수",
      })
    ).status,
  ).toBe(200);
  const current = organizationEmployee(row);
  expect(
    (
      await request(
        "/employees/junho/memberships/gangnam",
        "PUT",
        body(current, current.memberships[0]),
      )
    ).status,
  ).toBe(403);
  store.persona = "junho";
  expect((await request("/branches/gangnam")).status).toBe(403);
  expect((await request("/branches/seongsu")).status).toBe(200);
});

it("validates all days and uses a fresh branch version for the status command", async () => {
  expect(
    (
      await request("/branches/gangnam", "PATCH", {
        version: 1,
        weeklyHours: defaultHours().slice(1),
      })
    ).status,
  ).toBe(422);
  const hours = defaultHours();
  hours[0] = {
    weekday: 1,
    isClosed: true,
    opensMinute: null,
    closesMinute: null,
  };
  expect(
    (
      await request("/branches/gangnam", "PATCH", {
        version: 1,
        weeklyHours: hours,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/branches/gangnam/status", "POST", {
        version: 1,
        status: "운영 중지",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/branches/gangnam/status", "POST", {
        version: 2,
        status: "운영 중지",
      })
    ).status,
  ).toBe(200);
  expect(store.get("branches", "gangnam").status).toBe("운영 중지");
});

it("keeps default presets immutable, copies grants and never propagates later preset changes", async () => {
  const defaults = await (await request("/permission-presets")).json();
  expect(
    defaults.items.find((p: Preset) => p.role === "staff").permissions,
  ).toEqual([]);
  expect(
    defaults.items.find((p: Preset) => p.role === "admin").permissions,
  ).toHaveLength(9);
  expect(
    (
      await request("/permission-presets/system-staff", "PATCH", {
        version: 1,
        name: "수정",
        permissions: [],
      })
    ).status,
  ).toBe(403);
  const preset: Preset = await (
    await request("/permission-presets", "POST", {
      name: "운영",
      role: "staff",
      permissions: ["operations:write"],
    })
  ).json();
  const employee = organizationEmployee(store.get("employees", "junho"));
  expect(
    (
      await request("/employees/junho/memberships/gangnam", "PUT", {
        ...body(employee, employee.memberships[0]),
        presetId: preset.id,
        permissions: [...preset.permissions],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/permission-presets/${preset.id}`, "PATCH", {
        version: 1,
        name: "다른 운영",
        permissions: ["sales:read"],
      })
    ).status,
  ).toBe(200);
  expect(store.get("employees", "junho").memberships[0].permissions).toEqual([
    "operations:write",
  ]);
  expect(
    (
      await request("/employees/junho", "PATCH", {
        version: 2,
        email: "replacement@example.com",
      })
    ).status,
  ).toBe(422);
});
