import type { ResourceMap } from "../shared/domain/schema";

type Terms = ResourceMap["products"]["terms"];
const DAY = 86400000;
/** The mock has no purchase contract yet, so an unlimited validity is a distant date. */
const UNLIMITED_DAYS = 36500;

/** Flat pass values the mock purchase flow derives from a product's terms. */
export function passValues(terms: Terms) {
  if (terms.kind === "시간권")
    return {
      remaining: terms.includedMinutes,
      hourlyRate: 0,
      days: terms.validDays ?? UNLIMITED_DAYS,
    };
  if (terms.kind === "기간권")
    return {
      remaining: terms.periodDays,
      hourlyRate: 0,
      days: terms.periodDays,
    };
  return {
    remaining: terms.creditKrw,
    hourlyRate: terms.hourlyRateKrw,
    days: terms.validDays ?? UNLIMITED_DAYS,
  };
}
export const expiresAfter = (from: string, days: number) =>
  new Date(Date.parse(from) + days * DAY).toISOString();
