import { describe, expect, it } from "vitest";
import {
  formatBusinessDate,
  formatDateTime,
  formatKrw,
  formatNumber,
  formatPercent,
  formatShortDateTime,
} from "./format";

describe("shared display formats", () => {
  it("keeps zero, signed currency and large integer amounts readable", () => {
    expect(formatKrw(0)).toBe("0원");
    expect(formatKrw(-1234567)).toBe("-1,234,567원");
    expect(formatKrw(9007199254740993n)).toBe("9,007,199,254,740,993원");
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("does not replace missing or invalid amounts with zero", () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(formatKrw(value)).toBe("—");
      expect(formatNumber(value)).toBe("—");
    }
  });

  it("distinguishes a zero percent from an inapplicable or invalid rate", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(12.34)).toBe("12.3%");
    expect(formatPercent(100)).toBe("100.0%");
    expect(formatPercent(-12.34)).toBe("-12.3%");
    expect(formatPercent(12.3456, 2)).toBe("12.35%");
    expect(formatPercent(null)).toBe("해당 없음");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
    expect(formatPercent(Infinity)).toBe("—");
  });

  it("uses the Korean business day across UTC midnight boundaries", () => {
    expect(formatBusinessDate("2026-11-05T14:59:59Z")).toBe("2026-11-05");
    expect(formatBusinessDate("2026-11-05T15:00:00Z")).toBe("2026-11-06");
    expect(formatBusinessDate("2026-11-06T00:00:00+09:00")).toBe("2026-11-06");
  });

  it("preserves existing full and compact Korean date presentations", () => {
    const instant = "2026-11-05T15:04:05Z";
    expect(formatDateTime(instant)).toBe("2026. 11. 06. 00:04:05");
    expect(formatShortDateTime(instant)).toBe("11. 06. 00:04");
    expect(formatDateTime(instant)).toBe(
      formatDateTime("2026-11-06T00:04:05+09:00"),
    );
  });

  it("shows a missing marker instead of crashing on unavailable dates", () => {
    for (const value of [null, undefined, "", "  ", "not-a-date"]) {
      expect(formatBusinessDate(value)).toBe("—");
      expect(formatDateTime(value)).toBe("—");
      expect(formatShortDateTime(value)).toBe("—");
    }
  });
});
