import { afterEach, expect, it } from "vitest";
import { MockStore } from "./store";
afterEach(() => sessionStorage.clear());
it("keeps entered customer details out of demo persistence even when another resource emits", () => {
  sessionStorage.clear();
  const store = new MockStore(true);
  const fixture = store.db.members[0];
  fixture.name = "민감한 고객 입력";
  fixture.phone = "01999998888";
  fixture.email = "private-customer@example.test";
  fixture.note = "저장하지 않을 응대 메모";
  fixture.statusReason = "개인적인 상태 변경 사유";
  store.idempotency["legacy-customer-request"] = {
    fingerprint: JSON.stringify({ name: fixture.name, phone: fixture.phone }),
    result: structuredClone(fixture),
    authorization: "legacy",
  };
  store.add("audit", "gangnam", {
    actorId: "owner",
    resource: "members",
    targetId: fixture.id,
    action: "수정",
    before: "",
    after: JSON.stringify(fixture),
  });
  store.add("members", "gangnam", {
    name: "새 고객 입력",
    phone: "01988887777",
    email: "",
    note: "새 고객 메모",
    status: "정상",
    branchIds: ["gangnam"],
  });
  store.emit("products", "product-1", "gangnam");
  const saved = sessionStorage.getItem("openstudy-mock-v1")!;
  for (const value of [
    "민감한 고객 입력",
    "01999998888",
    "private-customer@example.test",
    "저장하지 않을 응대 메모",
    "개인적인 상태 변경 사유",
    "새 고객 입력",
    "01988887777",
    "새 고객 메모",
  ])
    expect(saved).not.toContain(value);
  expect(store.db.members[0].name).toBe("민감한 고객 입력");
  const reloaded = new MockStore(true);
  expect(reloaded.db.members[0].id).toBe(fixture.id);
  expect(reloaded.db.members[0].name).not.toBe(fixture.name);
});
