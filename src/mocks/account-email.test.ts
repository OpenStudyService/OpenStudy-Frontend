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
import { handlers } from "./handlers";
import { store } from "./store";

vi.hoisted(() => {
  // Register unrelated SSE handlers in jsdom; these tests do not exercise SSE.
  vi.stubGlobal("EventSource", class EventSource {});
});

const server = setupServer(...handlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
});
afterEach(() => {
  server.resetHandlers();
  store.reset();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function patch(path: string, body: object) {
  return fetch(new URL(`/api${path}`, window.location.origin), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

it.each(["replacement@openstudy.test", "owner@openstudy.test"])(
  "rejects profile email input (%s) without changing the account",
  async (email) => {
    const original = structuredClone(store.user());
    const response = await patch("/me/profile", {
      nickname: "변조된 닉네임",
      version: original.version,
      email,
    });
    expect(response.status).toBe(422);
    expect(store.user()).toEqual(original);
  },
);

it("updates the profile without changing the login email", async () => {
  const originalEmail = store.user().email;
  const response = await patch("/me/profile", {
    nickname: "새 닉네임",
    version: store.user().version,
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.user.nickname).toBe("새 닉네임");
  expect(result.user.email).toBe(originalEmail);
});

it.each(["owner", "minji", "junho"])(
  "uses the canonical versioned profile contract for %s",
  async (persona) => {
    store.persona = persona;
    const original = structuredClone(store.user());
    const response = await patch("/me/profile", {
      nickname: "  정규화 별명  ",
      version: original.version,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.user.nickname).toBe("정규화 별명");
    expect(result.user.version).toBe(original.version + 1);
    expect(result.user.email).toBe(original.email);
    expect(result.user.memberships).toEqual(
      expect.arrayContaining(
        original.memberships.map((m) => expect.objectContaining(m)),
      ),
    );
    const stale = await patch("/me/profile", {
      nickname: "오래된 수정",
      version: original.version,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "VERSION_CONFLICT",
      latestVersion: result.user.version,
      reloadUrl: "/api/me",
    });
    expect(store.user().nickname).toBe("정규화 별명");
  },
);

it.each(["avatar", "id", "owner", "status", "memberships", "permissions"])(
  "rejects protected profile field %s",
  async (field) => {
    const original = structuredClone(store.user());
    const response = await patch("/me/profile", {
      nickname: "위조",
      version: original.version,
      [field]: "forged",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { [field]: expect.any(String) },
    });
    expect(store.user()).toEqual(original);
  },
);

it.each(["", "  ", "가".repeat(101)])(
  "rejects invalid nickname %s",
  async (nickname) => {
    const original = structuredClone(store.user());
    const response = await patch("/me/profile", {
      nickname,
      version: original.version,
    });
    expect(response.status).toBe(422);
    expect(store.user()).toEqual(original);
  },
);

it("rejects an administrator changing an employee email without side effects", async () => {
  const original = structuredClone(store.get("employees", "junho"));
  const response = await patch("/employees/junho", {
    version: original.version,
    name: "변조된 이름",
    email: "replacement@openstudy.test",
  });
  expect(response.status).toBe(422);
  expect(store.get("employees", "junho")).toEqual(original);
});

it("allows administrator name updates while preserving the login email", async () => {
  const original = structuredClone(store.get("employees", "junho"));
  const response = await patch("/employees/junho", {
    version: original.version,
    name: "수정한 이름",
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.name).toBe("수정한 이름");
  expect(result.email).toBe(original.email);
});
