import { describe, expect, it } from "vitest";
import type { Pass } from "../payments/model";
import { adjustmentBody, timeRange, toDateInput, toInstant } from "./model";

const pass = {
  version: 3,
  kind: "시간권",
  remainingMinutes: 600,
  remainingCreditKrw: null,
  startedAt: "2026-11-01T00:00:00Z",
  expiresAt: "2026-12-01T00:00:00.123456Z",
} as Pass;
describe("Korean time boundaries", () => {
  it("converts Korean inputs to UTC and preserves [from,to) boundaries", () => {
    expect(timeRange("2026-11-02T09:00:00", "2026-11-03T09:00")).toEqual({
      from: "2026-11-02T00:00:00.000Z",
      to: "2026-11-03T00:00:00.000Z",
    });
    expect(timeRange("", "")).toEqual({ from: undefined, to: undefined });
    expect(toDateInput("2026-11-01T23:00:01Z")).toBe("2026-11-02T08:00:01");
  });
  it.each(["2026-02-30T09:00", "2026-11-02T25:00", "bad"])(
    "rejects invalid dates: %s",
    (date) => expect(() => toInstant(date)).toThrow(),
  );
  it("rejects reversed and equal ranges", () => {
    expect(() => timeRange("2026-11-02T09:00", "2026-11-02T09:00")).toThrow();
    expect(() => timeRange("2026-11-03T09:00", "2026-11-02T09:00")).toThrow();
  });
});
describe("partial after-value adjustments", () => {
  it("does not truncate untouched expiry or send irrelevant fields", () => {
    expect(
      adjustmentBody(
        pass,
        "700",
        toDateInput(pass.expiresAt),
        false,
        " 시간 보정 ",
      ),
    ).toEqual({ version: 3, reason: "시간 보정", remainingMinutes: 700 });
    expect(() =>
      adjustmentBody(pass, "600", toDateInput(pass.expiresAt), false, "same"),
    ).toThrow();
  });
  it("supports zero, expiry-only changes and explicit null for non-period passes", () => {
    expect(
      adjustmentBody(pass, "0", toDateInput(pass.expiresAt), false, "zero"),
    ).toMatchObject({ remainingMinutes: 0 });
    expect(adjustmentBody(pass, "600", "", true, "expiry")).toEqual({
      version: 3,
      reason: "expiry",
      expiresAt: null,
    });
    expect(
      adjustmentBody(
        { ...pass, kind: "정액권", remainingCreditKrw: 1000 },
        "2000",
        toDateInput(pass.expiresAt),
        false,
        "credit",
      ),
    ).toMatchObject({ remainingCreditKrw: 2000 });
  });
  it.each(["", "-1", "1.5", "4294967296", "1e3"])(
    "rejects invalid minutes: %s",
    (balance) => {
      expect(() => adjustmentBody(pass, balance, "", true, "reason")).toThrow();
    },
  );
  it("requires a reason and valid period expiry after start", () => {
    expect(() => adjustmentBody(pass, "700", "", true, " ")).toThrow();
    const period = { ...pass, kind: "기간권" } as Pass;
    expect(() => adjustmentBody(period, "", "", true, "reason")).toThrow();
    expect(() =>
      adjustmentBody(period, "", "2026-11-01T09:00", false, "reason"),
    ).toThrow();
    expect(
      adjustmentBody(period, "", "2026-12-02T09:00", false, "extend"),
    ).toEqual({
      version: 3,
      reason: "extend",
      expiresAt: "2026-12-02T00:00:00.000Z",
    });
  });
});
