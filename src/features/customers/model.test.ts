import { expect, it } from "vitest";
import {
  canCreateCustomer,
  createBody,
  draftFromCustomer,
  parseCustomerFilters,
  updateBody,
  validateDraft,
} from "./model";
import type { Customer } from "./model";
import { MockStore } from "../../mocks/store";

const customer: Customer = {
  id: "1",
  version: 3,
  memberNo: "MEMBER-1",
  name: "홍길동",
  phone: "01012345678",
  email: "old@example.test",
  memo: "기존 메모",
  status: "정상",
  statusReason: null,
  registeredBranchId: "gangnam",
  registeredAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  canEdit: true,
};
it("requires an explicit registration branch in all-branch view and validates canonical field limits", () => {
  const draft = {
    ...draftFromCustomer(undefined, "all"),
    name: "신규",
    phone: "010-1234-5678",
  };
  expect(validateDraft(draft, true)).toEqual({
    registeredBranchId: expect.any(String),
  });
  draft.registeredBranchId = "gangnam";
  expect(validateDraft(draft, true)).toEqual({});
  expect(createBody(draft)).toEqual({
    registeredBranchId: "gangnam",
    name: "신규",
    phone: "01012345678",
    email: null,
    memo: null,
  });
  expect(
    Object.keys(
      validateDraft(
        {
          ...draft,
          name: " ",
          phone: "0101",
          email: "bad",
          memo: "x".repeat(1001),
        },
        true,
      ),
    ),
  ).toEqual(["name", "phone", "email", "memo"]);
});
it("keeps only dirty fields at a consciously chosen version and supports nullable field clearing", () => {
  const draft = draftFromCustomer(customer);
  draft.name = "새 이름";
  draft.email = "";
  draft.phone = "010-1234-5678";
  expect(updateBody(customer, draft, 9)).toEqual({
    version: 9,
    name: "새 이름",
    email: null,
  });
  expect(updateBody(customer, draftFromCustomer(customer), 9)).toBeNull();
  expect(
    updateBody(
      customer,
      { ...draftFromCustomer(customer), registeredBranchId: "other" },
      9,
    ),
  ).toBeNull();
});
it("maps an unassigned customer without inventing a registration branch", () => {
  expect(
    draftFromCustomer({ ...customer, registeredBranchId: null })
      .registeredBranchId,
  ).toBe("");
});
it("bounds URL query parameters to the list contract and excludes UI-only detail keys", () => {
  const filters = parseCustomerFilters(
    new URLSearchParams(
      "q=홍&status=bad&sort=phone&direction=bad&page=-2&pageSize=1000&detail=1&edit=1",
    ),
  );
  expect(filters).toEqual({
    q: "홍",
    status: "",
    sort: "registeredAt",
    direction: "desc",
    page: 1,
    pageSize: 100,
  });
  expect(
    parseCustomerFilters(
      new URLSearchParams(
        "status=비활성&sort=name&direction=asc&page=2&pageSize=10",
      ),
    ),
  ).toEqual({
    q: "",
    status: "비활성",
    sort: "name",
    direction: "asc",
    page: 2,
    pageSize: 10,
  });
});
it("permits registration by membership permission rather than role and never treats all as a branch", () => {
  const db = new MockStore(false);
  const owner = db.db.employees.find((p) => p.owner)!;
  expect(canCreateCustomer(owner, "all")).toBe(false);
  expect(canCreateCustomer(owner, "")).toBe(false);
  expect(canCreateCustomer(owner, "gangnam")).toBe(true);
  const staff = db.db.employees.find((p) => p.id === "junho")!;
  const permitted = {
    ...staff,
    memberships: [
      { ...staff.memberships[0], permissions: ["members:write" as const] },
    ],
  };
  expect(canCreateCustomer(permitted, "gangnam")).toBe(true);
  expect(
    canCreateCustomer({ ...permitted, status: "이용 제한" }, "gangnam"),
  ).toBe(false);
  expect(canCreateCustomer(permitted, "seongsu")).toBe(false);
});
