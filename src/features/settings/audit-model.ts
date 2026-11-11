import type { components } from "../../shared/api/foundation.generated";

type Schemas = components["schemas"];
export type AuditEvent = Schemas["AuditEventListItem"];
export type AuditDetail = Schemas["AuditEventDetail"];
export type AuditPage = Schemas["AuditEventPage"];

export const auditSearchKeys = [
  "from",
  "to",
  "entityType",
  "entityId",
  "action",
  "actorEmployeeId",
  "branchId",
  "result",
  "requestId",
  "page",
  "pageSize",
] as const;
export const auditResults = ["SUCCESS", "DENIED", "FAILED"] as const;

export function auditSearchParams(source: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of auditSearchKeys) {
    for (const value of source.getAll(key)) query.append(key, value);
  }
  return query;
}

export function auditDateIsValid(date: string) {
  const time = new Date(date);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(time.getTime()) &&
    time.toISOString().slice(0, 10) === date
  );
}

export function auditPeriodError(from: string, to: string) {
  if ((from && !auditDateIsValid(from)) || (to && !auditDateIsValid(to)))
    return "날짜를 YYYY-MM-DD 형식으로 입력해 주세요.";
  if (!from || !to) return undefined;
  if (from > to) return "종료일은 시작일 이후여야 합니다.";
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 92)
    return "조회 기간은 최대 92일입니다.";
}

type Change = {
  path: string[];
  before: unknown;
  after: unknown;
  kind: "added" | "removed" | "changed" | "same";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function auditChanges(
  before: AuditDetail["before"],
  after: AuditDetail["after"],
) {
  const rows: Change[] = [];
  function compare(path: string[], previous: unknown, next: unknown) {
    const objects =
      (previous === undefined || isObject(previous)) &&
      (next === undefined || isObject(next));
    const arrays =
      (previous === undefined || Array.isArray(previous)) &&
      (next === undefined || Array.isArray(next));
    if (objects || arrays) {
      const left = new Map(Object.entries(previous ?? {}));
      const right = new Map(Object.entries(next ?? {}));
      const keys = new Set([...left.keys(), ...right.keys()]);
      if (keys.size) {
        for (const key of keys) {
          compare(
            [...path, arrays ? `[${key}]` : key],
            left.get(key),
            right.get(key),
          );
        }
        return;
      }
    }
    if (!path.length && previous === undefined && next === undefined) return;
    rows.push({
      path,
      before: previous,
      after: next,
      kind:
        previous === undefined
          ? "added"
          : next === undefined
            ? "removed"
            : previous === next || objects || arrays
              ? "same"
              : "changed",
    });
  }
  compare([], before ?? undefined, after ?? undefined);
  return rows;
}
