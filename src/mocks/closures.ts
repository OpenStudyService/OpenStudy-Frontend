import { http } from "msw/http";
import { z } from "zod";
import { admin, businessDate, can } from "../shared/domain/schema";
import type { Employee } from "../shared/domain/schema";
import { shiftClosureDate } from "../shared/domain/closures";
import type { StoredClosure } from "../shared/domain/closures";
import { paymentResponse as respond } from "./payments";
import { assert, DomainError, store } from "./store";

const today = () => businessDate(store.now());
const dateSchema = z.iso.date();
const note = z.string().min(1).max(200);
const create = z.strictObject({ date: dateSchema, note: note.optional() });
const update = z.strictObject({
  version: z.number().int().positive(),
  note: note.nullable(),
});
const rows = () => store.db.branchClosures ?? [];
export const closureRows = (branchId: string) =>
  rows()
    .filter((row) => row.branchId === branchId)
    .sort((a, b) => a.date.localeCompare(b.date));
const view = (row: StoredClosure, actor: Employee) => ({
  ...row,
  canEdit: admin(actor, row.branchId),
  canDelete: admin(actor, row.branchId) && row.date > today(),
});

function checkBranch(branchId: string, actor: Employee, write = false) {
  assert(can(actor, branchId), "지점에 접근할 수 없어요.", 403, "FORBIDDEN");
  assert(
    store.db.branches.some((branch) => branch.id === branchId),
    "지점을 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  if (write)
    assert(
      admin(actor, branchId),
      "휴무일을 변경할 권한이 없어요.",
      403,
      "FORBIDDEN",
    );
}

function writableClosure(id: string, actor: Employee, version: number) {
  const row = rows().find((item) => item.id === id);
  assert(
    row && can(actor, row.branchId),
    "휴무일을 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  checkBranch(row.branchId, actor, true);
  if (version !== row.version)
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "휴무일이 변경됐어요. 목록을 새로고침해 주세요.",
      undefined,
      row.version,
      `/api/branches/${row.branchId}/closures`,
    );
  return row;
}

export const closureHandlers = [
  http.get(
    "/api/branches/:id/closures",
    respond(({ request, params }, actor) => {
      const branchId = String(params.id);
      checkBranch(branchId, actor);
      const query = new URL(request.url).searchParams;
      assert(
        query.has("from") === query.has("to"),
        "시작일과 종료일을 함께 입력해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const from = dateSchema.parse(query.get("from") ?? today());
      const to = dateSchema.parse(
        query.get("to") ?? shiftClosureDate(today(), 90),
      );
      assert(
        to >= from,
        "조회 종료일을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        to <= shiftClosureDate(from, 366),
        "최대 366일까지 조회할 수 있어요.",
        422,
        "PERIOD_TOO_LONG",
      );
      return {
        branchId,
        from,
        to,
        items: closureRows(branchId)
          .filter((row) => row.date >= from && row.date <= to)
          .map((row) => view(row, actor)),
      };
    }),
  ),
  http.post(
    "/api/branches/:id/closures",
    respond(async ({ request, params }, actor) => {
      const branchId = String(params.id);
      checkBranch(branchId, actor, true);
      const input = create.parse(await request.json());
      const key = request.headers.get("Idempotency-Key");
      assert(key, "요청 키가 필요해요.", 422, "VALIDATION_FAILED");
      return store.transaction(
        `branch-closures:create:${key}`,
        { branchId, ...input },
        () => {
          if (
            input.date < today() ||
            input.date > shiftClosureDate(today(), 366)
          )
            throw new DomainError(
              422,
              "CLOSURE_DATE_INVALID",
              "오늘부터 366일 뒤까지 등록할 수 있어요.",
              { date: "등록 가능한 날짜 범위를 확인해 주세요." },
            );
          const existing = closureRows(branchId).find(
            (row) => row.date === input.date,
          );
          if (existing)
            throw new DomainError(
              409,
              "BRANCH_CLOSURE_EXISTS",
              "이미 등록된 휴무일이에요.",
              undefined,
              undefined,
              undefined,
              { closureId: existing.id },
            );
          const now = store.now();
          const closure = {
            id: crypto.randomUUID(),
            branchId,
            version: 1,
            date: input.date,
            note: input.note ?? null,
            createdAt: now,
            updatedAt: now,
            createdBy: { id: actor.id, name: actor.name },
          };
          (store.db.branchClosures ??= []).push(closure);
          const affected = store.db.reservations
            .filter(
              (r) =>
                r.branchId === branchId &&
                (r.status === "예약 확정" || r.status === "이용 중") &&
                businessDate(r.startsAt) === input.date,
            )
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
          return {
            closure: view(closure, actor),
            affectedReservationCount: affected.length,
            affectedReservations: affected.slice(0, 100).map((r) => ({
              id: r.id,
              roomId: r.roomId,
              roomName:
                store.db.rooms.find((room) => room.id === r.roomId)?.name ??
                r.roomId,
              startAt: r.startsAt,
              endAt: r.endsAt,
              status: r.status === "이용 중" ? "이용 중" : "확정",
            })),
          };
        },
      );
    }, 201),
  ),
  http.patch(
    "/api/branch-closures/:id",
    respond(async ({ request, params }, actor) => {
      const input = update.parse(await request.json());
      const row = writableClosure(String(params.id), actor, input.version);
      return store.transaction(undefined, input, () => {
        row.note = input.note;
        row.version += 1;
        row.updatedAt = store.now();
        return view(row, actor);
      });
    }),
  ),
  http.delete(
    "/api/branch-closures/:id",
    respond(({ request, params }, actor) => {
      const version = z
        .number()
        .int()
        .positive()
        .parse(Number(new URL(request.url).searchParams.get("version")));
      const row = writableClosure(String(params.id), actor, version);
      assert(
        row.date > today(),
        "오늘이나 지난 휴무일은 삭제할 수 없어요.",
        409,
        "CLOSURE_ALREADY_STARTED",
      );
      store.transaction(undefined, null, () => {
        store.db.branchClosures = rows().filter((item) => item.id !== row.id);
      });
    }, 204),
  ),
];
