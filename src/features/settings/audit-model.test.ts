import { expect, it } from "vitest";
import {
  auditChanges,
  auditPeriodError,
  auditSearchParams,
} from "./audit-model";

it("compares nested keys, additions, removals, nulls, and arrays without changing snapshots", () => {
  const before = {
    profile: { name: "이전", removed: true, nullable: null },
    password: "***",
    list: [{ a: 1, b: 2 }],
  };
  const after = {
    profile: { name: "이후", added: true, nullable: "value" },
    password: "***",
    list: [{ b: 2, a: 1 }],
  };
  const original = structuredClone(before);
  expect(auditChanges(before, after)).toEqual([
    {
      path: ["profile", "name"],
      before: "이전",
      after: "이후",
      kind: "changed",
    },
    {
      path: ["profile", "removed"],
      before: true,
      after: undefined,
      kind: "removed",
    },
    {
      path: ["profile", "nullable"],
      before: null,
      after: "value",
      kind: "changed",
    },
    {
      path: ["profile", "added"],
      before: undefined,
      after: true,
      kind: "added",
    },
    { path: ["password"], before: "***", after: "***", kind: "same" },
    { path: ["list", "[0]", "a"], before: 1, after: 1, kind: "same" },
    { path: ["list", "[0]", "b"], before: 2, after: 2, kind: "same" },
  ]);
  expect(before).toEqual(original);
  expect(
    auditChanges({ items: [{ value: 1 }] }, { items: [{ value: 2 }, "new"] }),
  ).toMatchObject([
    { path: ["items", "[0]", "value"], kind: "changed" },
    { path: ["items", "[1]"], kind: "added" },
  ]);
});

it("handles one-sided snapshots, empty objects, changed types, and ambiguous key names", () => {
  expect(auditChanges(null, null)).toEqual([]);
  expect(auditChanges(null, {})).toMatchObject([
    { path: [], kind: "added", after: {} },
  ]);
  expect(auditChanges({ x: { y: 1 } }, null)).toMatchObject([
    { path: ["x", "y"], kind: "removed" },
  ]);
  expect(auditChanges({ x: {} }, { x: 1 })).toMatchObject([
    { path: ["x"], kind: "changed" },
  ]);
  expect(
    auditChanges(null, { "x.y": 1, x: { y: 2 } }).map((row) => row.path),
  ).toEqual([["x.y"], ["x", "y"]]);
});

it("enforces the inclusive 92-day limit and real calendar dates", () => {
  expect(auditPeriodError("2026-01-01", "2026-04-02")).toBeUndefined();
  expect(auditPeriodError("2026-01-01", "2026-04-03")).toContain("92일");
  expect(auditPeriodError("2026-02-29", "")).toContain("날짜");
  expect(auditPeriodError("2026-11-11", "2026-11-10")).toContain("종료일");
  expect(auditPeriodError("", "2026-11-11")).toBeUndefined();
});

it("sends only contracted queries while preserving duplicate values for server validation", () => {
  expect(
    auditSearchParams(
      new URLSearchParams(
        "tab=audit&detail=10&scope=all&q=anything&sort=name&from=2026-11-01&requestId=req&result=SUCCESS&result=FAILED",
      ),
    ).toString(),
  ).toBe("from=2026-11-01&result=SUCCESS&result=FAILED&requestId=req");
});
