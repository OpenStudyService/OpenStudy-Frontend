import type { AuditDetail, AuditPage } from "../features/settings/audit-model";
import {
  auditDateIsValid,
  auditPeriodError,
  auditResults,
  auditSearchKeys,
} from "../features/settings/audit-model";
import { shiftClosureDate } from "../shared/domain/closures";
import { formatBusinessDate } from "../shared/domain/format";
import { assert, DomainError, store } from "./store";

let database: typeof store.db | undefined;
let fixtures: AuditDetail[] = [];

function owner() {
  assert(
    store.activeUser().owner,
    "OWNER만 변경 이력을 조회할 수 있습니다.",
    403,
    "FORBIDDEN",
  );
}

function snapshots(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  return mask(parsed) as Record<string, unknown>;
}

function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      if (/password|token|secret|hash|csrf|session|credential/i.test(key))
        return [key, "***"];
      if (/phone|contact/i.test(key) && typeof field === "string") {
        const digits = [...field].filter((char) => /\p{Nd}/u.test(char)).length;
        let seen = 0;
        return [
          key,
          [...field]
            .map((char) => {
              if (!/\p{Nd}/u.test(char)) return char;
              return ++seen <= digits - 4 ? "*" : char;
            })
            .join(""),
        ];
      }
      return [key, mask(field)];
    }),
  );
}

function events(): AuditDetail[] {
  if (database !== store.db) {
    database = store.db;
    const occurredAt = store.now();
    const common = {
      occurredAt,
      entityType: "employee",
      entityId: "2",
      reason: null,
      actor: null,
      branch: null,
      hasChanges: false,
      before: null,
      after: null,
      requestId: "mock-audit-request",
    };
    fixtures = [
      {
        ...common,
        id: "1",
        action: "PROFILE_UPDATED",
        result: "SUCCESS",
        actor: {
          id: "owner",
          name:
            store.db.employees.find((employee) => employee.id === "owner")
              ?.name || "사장님",
        },
        branch: { id: "gangnam", name: "강남점" },
        hasChanges: true,
        before: {
          nickname: "이전 별명",
          profile: { phone: "***-****-5678", theme: "forest" },
          oldField: true,
        },
        after: {
          nickname: "새 별명",
          profile: { phone: "***-****-5678", theme: "navy" },
          newField: true,
        },
      },
      {
        ...common,
        id: "2",
        action: "LOGIN_FAILED",
        result: "FAILED",
        reason: "BAD_CREDENTIALS",
      },
      {
        ...common,
        id: "3",
        action: "ACCESS_DENIED",
        result: "DENIED",
        reason: "FORBIDDEN",
      },
    ];
  }
  const legacy = store.db.audit.map((row): AuditDetail => {
    const actor = store.db.employees.find(
      (employee) => employee.id === row.actorId,
    );
    const branch = store.db.branches.find((entry) => entry.id === row.branchId);
    const before = snapshots(row.before);
    const after = snapshots(row.after);
    return {
      id: row.id,
      occurredAt: row.createdAt,
      action: row.action,
      result: "SUCCESS",
      entityType: row.resource,
      entityId: row.targetId || null,
      reason: null,
      requestId: null,
      actor: actor ? { id: actor.id, name: actor.name } : null,
      branch: branch ? { id: branch.id, name: branch.name } : null,
      hasChanges: before !== null || after !== null,
      before,
      after,
    };
  });
  return [...fixtures, ...legacy];
}

function invalid(
  field: string,
  message: string,
  code = "VALIDATION_FAILED",
): never {
  throw new DomainError(422, code, message, { [field]: message });
}

export function searchAuditEvents(request: Request): AuditPage {
  owner();
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!(auditSearchKeys as readonly string[]).includes(key))
      invalid(key, "허용되지 않은 검색 조건입니다.");
    if (params.getAll(key).length !== 1)
      invalid(key, "검색 조건은 한 번만 입력해 주세요.");
    if (!params.get(key)) invalid(key, "검색 조건을 입력해 주세요.");
  }
  let from = params.get("from") || "";
  let to = params.get("to") || "";
  for (const key of ["from", "to"]) {
    if (params.has(key) && !auditDateIsValid(params.get(key)!))
      invalid(key, "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  if (!from && !to) to = formatBusinessDate(store.now());
  if (!from) from = shiftClosureDate(to, -6);
  if (!to) to = shiftClosureDate(from, 6);
  const error = auditPeriodError(from, to);
  if (error)
    invalid("to", error, from <= to ? "PERIOD_TOO_LONG" : "VALIDATION_FAILED");
  for (const [key, max] of [
    ["entityType", 80],
    ["action", 80],
    ["requestId", 128],
  ] as const) {
    if ((params.get(key)?.length ?? 0) > max)
      invalid(key, `1~${max}자로 입력해 주세요.`);
  }
  if (params.has("entityId") && !params.has("entityType"))
    invalid("entityId", "대상 ID는 대상 유형과 함께 입력해 주세요.");
  if (
    params.has("result") &&
    !(auditResults as readonly string[]).includes(params.get("result")!)
  )
    invalid("result", "결과는 SUCCESS, DENIED, FAILED 중 하나입니다.");
  function number(key: string, fallback: number, max: number) {
    const raw = params.get(key);
    const value = raw === null ? fallback : Number(raw);
    if (
      (raw !== null && !/^\+?\d+$/.test(raw)) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > max
    )
      invalid(key, `1~${max} 사이의 숫자여야 합니다.`);
    return value;
  }
  const page = number("page", 1, Number.MAX_SAFE_INTEGER);
  const pageSize = number("pageSize", 20, 100);
  const rows = events();
  for (const key of ["entityId", "actorEmployeeId", "branchId"] as const) {
    const value = params.get(key);
    // Existing demo employee/branch IDs are aliases. Preserve those fixtures alongside decimal IDs.
    const known =
      key === "actorEmployeeId"
        ? store.db.employees.some((row) => row.id === value)
        : key === "branchId"
          ? store.db.branches.some((row) => row.id === value)
          : rows.some((row) => row.entityId === value);
    if (
      value &&
      !known &&
      (!/^[1-9][0-9]{0,18}$/.test(value) ||
        BigInt(value) > 9_223_372_036_854_775_807n)
    )
      invalid(key, "ID 형식이 아닙니다.");
  }
  const matches = rows
    .filter((event) => {
      const date = formatBusinessDate(event.occurredAt);
      if (date < from || date > to) return false;
      const values = {
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        actorEmployeeId: event.actor?.id,
        branchId: event.branch?.id,
        result: event.result,
        requestId: event.requestId,
      };
      return Object.entries(values).every(
        ([key, value]) => !params.has(key) || params.get(key) === value,
      );
    })
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        (BigInt(right.id) > BigInt(left.id)
          ? 1
          : BigInt(right.id) < BigInt(left.id)
            ? -1
            : 0),
    );
  return {
    items: (store.scenario === "empty"
      ? []
      : matches.slice((page - 1) * pageSize, page * pageSize)
    ).map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      action: event.action,
      result: event.result,
      entityType: event.entityType,
      entityId: event.entityId,
      reason: event.reason,
      requestId: event.requestId,
      actor: event.actor,
      branch: event.branch,
      hasChanges: event.hasChanges,
    })),
    meta: {
      page,
      pageSize,
      total: store.scenario === "empty" ? 0 : matches.length,
    },
    period: { from, to },
  };
}

export function getAuditEvent(id: string): AuditDetail {
  owner();
  const event = events().find((entry) => entry.id === id);
  assert(event, "감사 기록을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return {
    ...event,
    before: snapshots(event.before),
    after: snapshots(event.after),
  };
}
