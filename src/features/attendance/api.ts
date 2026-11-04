import type { components } from "../../shared/api/foundation.generated";
import { api, queryString } from "../../shared/api/client";
export type Shift = components["schemas"]["Shift"];
export type Weekly = components["schemas"]["WeeklyShiftSchedule"];
export type Conflict = components["schemas"]["ShiftConflict"];
export const weekly = (scope: string, weekOf: string, signal?: AbortSignal) =>
  api<Weekly>(`/shifts/weekly?${queryString({ scope, weekOf })}`, { signal });
export const getShift = (id: string, signal?: AbortSignal) =>
  api<Shift>(`/shifts/${encodeURIComponent(id)}`, { signal });
// datetime-local is a Seoul wall clock regardless of the browser's timezone.
export const seoulInstant = (value: string) =>
  new Date(`${value}:00+09:00`).toISOString();
export const seoulInput = (value: string) =>
  new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16);
export const shiftTime = (value: string) => seoulInput(value).replace("T", " ");
export function weekDays(selected: string) {
  const date = new Date(`${selected}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return [];
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) =>
    new Date(date.getTime() + i * 86400000).toISOString().slice(0, 10),
  );
}
