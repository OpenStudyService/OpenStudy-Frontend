import { describe, expect, it } from "vitest";
import {
  canManageProduct,
  canWriteBranch,
  createBody,
  draftFromProduct,
  emptyDraft,
  positiveInteger,
  snapshotChanges,
  termsFromDraft,
  termsLabel,
  updateBody,
  validateDraft,
} from "./model";
import type { Draft, Product, ProductSnapshot } from "./model";
import type { Employee } from "../../shared/domain/schema";

const category = {
  id: "c1",
  version: 1,
  createdAt: "",
  updatedAt: "",
  code: "TIME",
  name: "시간권",
  kind: "시간권" as const,
  status: "활성" as const,
};
const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  version: 3,
  createdAt: "",
  updatedAt: "",
  code: "T10",
  name: "10시간권",
  priceKrw: 15000,
  terms: { kind: "시간권", includedMinutes: 600, validDays: null },
  status: "판매 중",
  category,
  branchIds: ["a", "b"],
  canEdit: true,
  ...over,
});
const user = (over: Partial<Employee> = {}) =>
  ({
    id: "u",
    status: "활성",
    owner: false,
    memberships: [],
    ...over,
  }) as unknown as Employee;
const filled = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("시간권"),
  name: "10시간권",
  price: "15000",
  includedMinutes: "600",
  unlimited: true,
  categoryId: "c1",
  branchIds: ["a"],
  ...over,
});

describe("numeric input", () => {
  it("accepts only whole positive numbers within range", () => {
    expect(positiveInteger("600", 4294967295)).toBe(600);
    for (const bad of ["", "0", "-1", "1.5", "1e3", " ", "01", "abc", "４"])
      expect(positiveInteger(bad, 4294967295)).toBeNull();
    expect(positiveInteger("4294967296", 4294967295)).toBeNull();
    expect(
      positiveInteger("9007199254740993", Number.MAX_SAFE_INTEGER),
    ).toBeNull();
  });
});

describe("terms by kind", () => {
  it("sends only the selected kind's fields, with null for unlimited validity", () => {
    const stale = {
      periodDays: "30",
      creditKrw: "5000",
      hourlyRateKrw: "1000",
    };
    expect(termsFromDraft(filled(stale)).terms).toEqual({
      kind: "시간권",
      includedMinutes: 600,
      validDays: null,
    });
    expect(
      termsFromDraft(filled({ ...stale, kind: "기간권", periodDays: "28" }))
        .terms,
    ).toEqual({ kind: "기간권", periodDays: 28 });
    expect(
      termsFromDraft(
        filled({
          kind: "정액권",
          creditKrw: "100000",
          hourlyRateKrw: "1500",
          unlimited: false,
          validDays: "180",
        }),
      ).terms,
    ).toEqual({
      kind: "정액권",
      creditKrw: 100000,
      hourlyRateKrw: 1500,
      validDays: 180,
    });
  });
  it("does not treat an empty or zero validity as unlimited", () => {
    for (const validDays of ["", "0"]) {
      const result = termsFromDraft(filled({ unlimited: false, validDays }));
      expect(result.terms).toBeUndefined();
      expect(result.errors.validDays).toMatch(/무기한/);
    }
  });
  it("reports each invalid unit separately", () => {
    const result = termsFromDraft(
      filled({
        kind: "정액권",
        creditKrw: "0",
        hourlyRateKrw: "x",
        unlimited: true,
      }),
    );
    expect(Object.keys(result.errors).sort()).toEqual([
      "creditKrw",
      "hourlyRateKrw",
    ]);
  });
});

describe("draft validation", () => {
  it("rejects a zero price, missing category and no sale branch on create", () => {
    const { errors } = validateDraft(
      filled({ price: "0", categoryId: "", branchIds: [] }),
      "create",
    );
    expect(Object.keys(errors).sort()).toEqual([
      "branchIds",
      "categoryId",
      "price",
    ]);
    expect(validateDraft(filled({ branchIds: [] }), "edit").errors).toEqual({});
  });
  it("builds a create body with sorted branches", () => {
    const draft = filled({ branchIds: ["b", "a"] });
    const checked = validateDraft(draft, "create");
    expect(createBody(draft, checked.terms!, checked.priceKrw!)).toEqual({
      name: "10시간권",
      priceKrw: 15000,
      terms: { kind: "시간권", includedMinutes: 600, validDays: null },
      status: "판매 중",
      categoryId: "c1",
      branchIds: ["a", "b"],
    });
  });
});

describe("update body", () => {
  it("sends only changed fields with the latest version, comparing against the draft's origin", () => {
    const base = product();
    const draft = { ...draftFromProduct(base), price: "16000" };
    const checked = validateDraft(draft, "edit");
    expect(
      updateBody(base, draft, checked.terms!, checked.priceKrw!, 3),
    ).toEqual({ version: 3, priceKrw: 16000 });
    // After a conflict reload only the edited field may be sent.
    expect(
      updateBody(base, draft, checked.terms!, checked.priceKrw!, 5),
    ).toEqual({ version: 5, priceKrw: 16000 });
  });
  it("sends the complete terms when any unit changes and null when nothing changed", () => {
    const base = product();
    const edited = { ...draftFromProduct(base), includedMinutes: "900" };
    const checked = validateDraft(edited, "edit");
    expect(
      updateBody(base, edited, checked.terms!, checked.priceKrw!, 3)?.terms,
    ).toEqual({ kind: "시간권", includedMinutes: 900, validDays: null });
    const same = validateDraft(draftFromProduct(base), "edit");
    expect(
      updateBody(base, draftFromProduct(base), same.terms!, same.priceKrw!, 3),
    ).toBeNull();
  });
  it("round-trips unlimited validity", () => {
    expect(draftFromProduct(product()).unlimited).toBe(true);
    expect(
      draftFromProduct(
        product({
          terms: { kind: "시간권", includedMinutes: 60, validDays: 30 },
        }),
      ),
    ).toMatchObject({ unlimited: false, validDays: "30" });
  });
});

describe("permission hints", () => {
  const membership = (
    branchId: string,
    role: "admin" | "staff",
    permissions: string[],
  ) => ({ branchId, role, permissions, status: "활성" });
  it("separates writing from managing and requires every selling branch", () => {
    const writer = user({
      memberships: [
        membership("a", "staff", ["operations:write"]),
      ] as Employee["memberships"],
    });
    expect(canWriteBranch(writer, "a")).toBe(true);
    expect(canWriteBranch(writer, "b")).toBe(false);
    const manager = user({
      memberships: [
        membership("a", "admin", ["operations:write"]),
        membership("b", "admin", ["operations:write"]),
      ] as Employee["memberships"],
    });
    expect(canManageProduct(manager, product())).toBe(true);
    expect(canManageProduct(writer, product({ branchIds: ["a"] }))).toBe(false);
    expect(canManageProduct(manager, product({ canEdit: false }))).toBe(false);
    expect(canManageProduct(user({ owner: true }), product())).toBe(true);
  });
  it("ignores revoked memberships", () => {
    const revoked = user({
      memberships: [
        { ...membership("a", "admin", ["operations:write"]), status: "회수" },
      ] as Employee["memberships"],
    });
    expect(canWriteBranch(revoked, "a")).toBe(false);
  });
});

describe("history differences", () => {
  const snap = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
    schemaVersion: 1,
    code: "T10",
    name: "10시간권",
    priceKrw: 15000,
    terms: { kind: "시간권", includedMinutes: 600, validDays: null },
    status: "판매 중",
    categoryCode: "TIME",
    categoryName: "시간권",
    branchIds: ["a"],
    ...over,
  });
  const name = (id: string) => ({ a: "강남점", b: "성수점" })[id] ?? id;
  it("lists only changed fields and shows both sides", () => {
    const changes = snapshotChanges(
      snap(),
      snap({ priceKrw: 16000, branchIds: ["a", "b"] }),
      name,
    );
    expect(changes).toEqual([
      { label: "판매 금액", before: "15,000원", after: "16,000원" },
      { label: "판매 지점", before: "강남점", after: "강남점, 성수점" },
    ]);
  });
  it("lists every field for the first revision", () => {
    expect(snapshotChanges(null, snap(), name)).toHaveLength(7);
  });
  it("describes unlimited validity in plain words", () => {
    expect(termsLabel(product().terms)).toContain("무기한");
  });
});
