import { hasCustomerLookup } from "./customer-lookup-access";
/** Canonical M7 demo adapter over the existing facility/inquiry/notice ledger. Never imported by live. */
import { http, HttpResponse } from "msw/http";
import { delay } from "msw";
import { z } from "zod";
import { admin, businessDate, can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import type { components } from "../shared/api/foundation.generated";
import { store, assert, DomainError } from "./store";
type S = components["schemas"];
type R = "facilities" | "inquiries" | "notices";
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const actor = (id: string) => {
  const e = store.db.employees.find((e) => e.id === id);
  return e ? { id: e.id, name: e.name } : null;
};
const baseTypes = [
  { id: "facility-type-1", name: "시설 이상", defaultInspectionDays: 14 },
  { id: "facility-type-2", name: "정기 점검", defaultInspectionDays: 30 },
];
function allTypes(): S["FacilityType"][] {
  const found = new Map(baseTypes.map((t) => [t.id, t]));
  for (const [key, value] of Object.entries(store.idempotency))
    if (key.includes(":facility-types:")) {
      const type = value.result as S["FacilityType"];
      found.set(type.id, type);
    }
  for (const row of store.db.facilities)
    if (row.collaboration)
      found.set(row.collaboration.type.id, row.collaboration.type);
  return [...found.values()];
}
function facility(
  row: ResourceMap["facilities"],
  user: Employee,
): S["Facility"] {
  const data: S["Facility"] = row.collaboration ?? {
    id: row.id,
    branchId: row.branchId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    name: row.title,
    type: allTypes().find((t) => t.name === row.category) ?? baseTypes[0],
    location: null,
    description: row.body,
    status: row.condition,
    inspectionIntervalDays: row.cycleDays,
    lastInspectedOn: row.lastChecked || null,
    nextInspectionOn: row.nextCheck,
    inspectionDue: false,
    openWork: {
      id: `${row.id}-open`,
      status: row.status === "진행 중" ? "진행 중" : "대기",
      assignee: actor(row.assigneeId),
      openedAt: row.updatedAt,
    },
    lastInspection: row.result
      ? { result: row.result, completedOn: row.lastChecked, completedBy: null }
      : null,
    canEdit: false,
    canComplete: false,
  };
  const next = data.lastInspectedOn
    ? new Date(
        Date.parse(`${data.lastInspectedOn}T00:00:00Z`) +
          data.inspectionIntervalDays * 86400000,
      )
        .toISOString()
        .slice(0, 10)
    : businessDate(row.createdAt);
  return {
    ...data,
    nextInspectionOn: next,
    inspectionDue:
      next <= businessDate(store.now()) && data.status !== "사용 중지",
    canEdit: can(user, row.branchId, "facilities:write"),
    canComplete:
      can(user, row.branchId) &&
      (data.openWork.assignee?.id === user.id ||
        can(user, row.branchId, "facilities:write")),
  };
}
function inquiry(row: ResourceMap["inquiries"], user: Employee): S["Inquiry"] {
  const customer = store.db.members.find((c) => c.id === row.memberId);
  const data: S["Inquiry"] = row.collaboration ?? {
    id: row.id,
    branchId: row.branchId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customer: {
      id: row.memberId,
      name: customer?.name ?? "고객",
      memberNo: customer?.memberNo ?? row.memberId,
    },
    subject: row.title,
    body: row.body,
    source: "방문",
    status: row.status,
    assignee: actor(row.assigneeId),
    createdBy: actor("owner")!,
    answer: row.reply || null,
    answeredBy: null,
    answeredAt: null,
    canChangeAssignee: false,
  };
  return {
    ...data,
    canChangeAssignee:
      admin(user, row.branchId) || data.assignee?.id === user.id,
  };
}
function notice(row: ResourceMap["notices"], user: Employee): S["Notice"] {
  const data: S["Notice"] = row.collaboration ?? {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    body: row.body,
    author: actor(row.authorId)!,
    pinned: row.pinned,
    status: row.status,
    target: row.branchId === "all" ? "전체" : "선택 지점",
    branchIds: row.branchId === "all" ? [] : [row.branchId],
    publishedAt: row.createdAt,
    canEdit: false,
  };
  return {
    ...data,
    branchIds: data.branchIds.filter((b) => can(user, b)),
    canEdit:
      data.target === "전체"
        ? user.owner
        : data.branchIds.every((b) => can(user, b, "notices:write")),
  };
}
const view = (r: R, id: string, u: Employee) =>
  r === "facilities"
    ? facility(
        store.db.facilities.find((x) => x.id === id)!,
        u,
      )
    : r === "inquiries"
      ? inquiry(
          store.db.inquiries.find((x) => x.id === id)!,
          u,
        )
      : notice(
          store.db.notices.find((x) => x.id === id)!,
          u,
        );
function allowed(a: Args, r: R, u: Employee) {
  const scope = new URL(a.request.url).searchParams.get("scope") ?? "all";
  assert(
    scope === "all" || can(u, scope),
    "지점 접근 권한이 없습니다.",
    403,
    "FORBIDDEN",
  );
  return store.db[r]
    .map((row) => view(r, row.id, u))
    .filter((row) => {
      if ("branchId" in row)
        return (
          can(u, row.branchId) && (scope === "all" || scope === row.branchId)
        );
      return (
        (row.target === "전체" ||
          row.branchIds.some(
            (b) => can(u, b) && (scope === "all" || scope === b),
          )) &&
        (row.status === "게시 중" || row.canEdit)
      );
    });
}
const respond =
  (fn: (a: Args, u: Employee) => unknown | Promise<unknown>, status = 200) =>
  async (a: Args) => {
    try {
      const before = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const u = store.activeUser();
      assert(u.id === before, "권한이 변경되었습니다.", 403, "FORBIDDEN");
      assert(
        store.scenario !== "error",
        "일시적인 서버 오류입니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "인증을 확인하세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json((await fn(a, u)) as Record<string, unknown>, {
        status,
      });
    } catch (e) {
      if (e instanceof z.ZodError)
        return HttpResponse.json(
          {
            code: "VALIDATION_FAILED",
            message: "입력을 확인하세요.",
            fieldErrors: Object.fromEntries(
              e.issues.map((i) => [i.path.join("."), i.message]),
            ),
          },
          { status: 422 },
        );
      if (e instanceof DomainError)
        return HttpResponse.json(
          {
            code: e.code,
            message: e.message,
            fieldErrors: e.fieldErrors,
            latestVersion: e.latestVersion,
            reloadUrl: e.reloadUrl,
          },
          { status: e.status },
        );
      throw e;
    }
  };
const text = z.string().trim().min(1),
  version = z.number().int().nonnegative();
function paginate(a: Args, rows: unknown[]) {
  const p = new URL(a.request.url).searchParams,
    page = Number(p.get("page") ?? 1),
    pageSize = Number(p.get("pageSize") ?? 20);
  assert(
    Number.isInteger(page) &&
      page > 0 &&
      Number.isInteger(pageSize) &&
      pageSize > 0 &&
      pageSize <= 100,
    "페이지를 확인하세요.",
    422,
  );
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: rows.length },
  };
}
function persist(r: R, data: S["Facility"] | S["Inquiry"] | S["Notice"]) {
  if (r === "facilities" && "openWork" in data) {
    let row = store.db.facilities.find((x) => x.id === data.id);
    if (!row) {
      row = {
        ...data,
        title: data.name,
        category: data.type.name,
        assigneeId: data.openWork.assignee?.id ?? "",
        body: data.description ?? "",
        cycleDays: data.inspectionIntervalDays,
        lastChecked: data.lastInspectedOn ?? "",
        nextCheck: data.nextInspectionOn,
        condition: data.status,
        status: "할 일",
        result: "",
      };
      store.db.facilities.push(row);
    }
    Object.assign(row, {
      collaboration: data,
      title: data.name,
      condition: data.status,
      assigneeId: data.openWork.assignee?.id ?? "",
      body: data.description ?? "",
      version: data.version,
      updatedAt: data.updatedAt,
      nextCheck: data.nextInspectionOn,
    });
  } else if (r === "inquiries" && "customer" in data) {
    let row = store.db.inquiries.find((x) => x.id === data.id);
    if (!row) {
      row = {
        ...data,
        title: data.subject,
        memberId: data.customer.id,
        assigneeId: data.assignee?.id ?? "",
        reply: data.answer ?? "",
      };
      store.db.inquiries.push(row);
    }
    Object.assign(row, {
      collaboration: data,
      status: data.status,
      reply: data.answer ?? "",
      version: data.version,
      updatedAt: data.updatedAt,
    });
  } else if ("pinned" in data) {
    let row = store.db.notices.find((x) => x.id === data.id);
    if (!row) {
      row = {
        ...data,
        branchId: data.target === "전체" ? "all" : data.branchIds[0],
        authorId: data.author.id,
        status: "게시 중",
      };
      store.db.notices.push(row);
    }
    Object.assign(row, {
      collaboration: data,
      title: data.title,
      body: data.body,
      pinned: data.pinned,
      version: data.version,
      updatedAt: data.updatedAt,
    });
  }
  store.persist();
  store.emit(r, data.id, "branchId" in data ? data.branchId : "all");
}
const handlers = (["facilities", "inquiries", "notices"] as R[]).flatMap(
  (r) => [
    http.get(
      `/api/${r}`,
      respond((a, u) => {
        const p = new URL(a.request.url).searchParams,
          q = (p.get("q") ?? "").toLowerCase();
        const rows = allowed(a, r, u).filter(
          (row) =>
            (!p.get("status") || row.status === p.get("status")) &&
            (!q ||
              ("name" in row
                ? row.name
                : "subject" in row
                  ? `${row.subject} ${row.customer.name}`
                  : row.title
              )
                .toLowerCase()
                .includes(q)),
        );
        rows.sort((a, b) =>
          "pinned" in a && "pinned" in b
            ? Number(b.pinned) - Number(a.pinned) ||
              (b.publishedAt ?? b.createdAt).localeCompare(
                a.publishedAt ?? a.createdAt,
              )
            : "nextInspectionOn" in a && "nextInspectionOn" in b
              ? a.nextInspectionOn.localeCompare(b.nextInspectionOn)
              : b.createdAt.localeCompare(a.createdAt),
        );
        return paginate(a, rows);
      }),
    ),
    ...(r === "notices"
      ? []
      : [
          http.get(
            `/api/${r}/summary`,
            respond((a, u) => {
              const q = (
                  new URL(a.request.url).searchParams.get("q") ?? ""
                ).toLowerCase(),
                rows = allowed(a, r, u).filter(
                  (row) =>
                    !q ||
                    ("name" in row
                      ? row.name
                      : "subject" in row
                        ? `${row.subject} ${row.customer.name}`
                        : ""
                    )
                      .toLowerCase()
                      .includes(q),
                );
              const count = (s: string) =>
                rows.filter((x) => x.status === s).length;
              return {
                asOf: store.now(),
                totals:
                  r === "facilities"
                    ? {
                        total: rows.length,
                        normal: count("정상"),
                        checkNeeded: count("점검 필요"),
                        broken: count("고장"),
                        outOfService: count("사용 중지"),
                        inspectionDue: rows.filter(
                          (x) => "inspectionDue" in x && x.inspectionDue,
                        ).length,
                      }
                    : {
                        total: rows.length,
                        received: count("접수"),
                        inProgress: count("처리 중"),
                        answered: count("답변 완료"),
                        unresolved: count("접수") + count("처리 중"),
                      },
                branches: [],
              };
            }),
          ),
        ]),
    http.get(
      `/api/${r}/:id`,
      respond((a, u) => {
        const row = allowed(a, r, u).find((x) => x.id === a.params.id);
        assert(row, "찾을 수 없습니다.", 404, "NOT_FOUND");
        return row;
      }),
    ),
    http.post(
      `/api/${r}`,
      respond(async (a, u) => {
        const b = (await a.request.json()) as Record<string, unknown>,
          key = a.request.headers.get("Idempotency-Key");
        assert(key, "요청 키가 필요합니다.", 422);
        const branch = String(b.branchId ?? ""),
          now = store.now(),
          id = crypto.randomUUID();
        if (r !== "notices") {
          assert(
            allowedBranches(u).includes(branch),
            "지점 권한이 없습니다.",
            403,
          );
          if (r === "facilities")
            assert(
              can(u, branch, "facilities:write"),
              "시설 등록 권한이 없습니다.",
              403,
            );
        }
        if (r === "notices")
          assert(
            b.target === "전체"
              ? u.owner
              : Array.isArray(b.branchIds) &&
                  b.branchIds.length > 0 &&
                  b.branchIds.every(
                    (id) =>
                      typeof id === "string" && can(u, id, "notices:write"),
                  ),
            "공지 작성 권한이 없습니다.",
            403,
            "FORBIDDEN",
          );
        const old = store.idempotency[`${u.id}:${r}:${key}`];
        if (old) {
          assert(
            old.fingerprint === JSON.stringify(b),
            "다른 입력입니다.",
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          return old.result;
        }
        const shared = { id, version: 1, createdAt: now, updatedAt: now };
        let data: S["Facility"] | S["Inquiry"] | S["Notice"];
        if (r === "facilities") {
          const type = allTypes().find((t) => t.id === b.typeId);
          assert(type, "유형을 선택하세요.", 422);
          const last = b.lastInspectedOn
            ? z.iso.date().parse(b.lastInspectedOn)
            : null;
          data = {
            ...shared,
            branchId: branch,
            name: text.max(120).parse(b.name),
            type,
            location: typeof b.location === "string" ? b.location : null,
            description:
              typeof b.description === "string" ? b.description : null,
            status: z
              .enum(["정상", "점검 필요", "고장", "사용 중지"])
              .parse(b.status ?? "정상"),
            inspectionIntervalDays: z
              .number()
              .int()
              .positive()
              .parse(b.inspectionIntervalDays ?? type.defaultInspectionDays),
            lastInspectedOn: last,
            nextInspectionOn: businessDate(now),
            inspectionDue: true,
            openWork: {
              id: crypto.randomUUID(),
              status: "대기",
              assignee: resolveAssignee(b.assigneeId, branch),
              openedAt: now,
            },
            canEdit: true,
            canComplete: true,
            lastInspection:
              last && b.lastInspectionResult
                ? {
                    completedOn: last,
                    result: text.max(5000).parse(b.lastInspectionResult),
                    completedBy: actor(u.id),
                  }
                : null,
          };
        } else if (r === "inquiries") {
          const c = store.db.members.find((c) => c.id === b.customerId);
          assert(
            c &&
              (u.owner ||
                c.branchIds.some((x) => can(u, x)) ||
                hasCustomerLookup(u.id, branch, c.id)),
            "고객을 찾을 수 없습니다.",
            404,
          );
          data = {
            ...shared,
            branchId: branch,
            customer: { id: c.id, name: c.name, memberNo: c.memberNo ?? c.id },
            subject: text.max(200).parse(b.subject),
            body: text.max(20000).parse(b.body),
            source: z.enum(["방문", "전화", "기타"]).parse(b.source),
            status: z.enum(["접수", "처리 중"]).parse(b.status ?? "접수"),
            assignee: resolveAssignee(b.assigneeId, branch),
            createdBy: actor(u.id)!,
            answer: null,
            answeredAt: null,
            answeredBy: null,
            canChangeAssignee: admin(u, branch),
          };
        } else {
          const target = z.enum(["전체", "선택 지점"]).parse(b.target),
            branchIds =
              target === "전체" ? [] : z.array(text).min(1).parse(b.branchIds);
          assert(
            target === "전체"
              ? u.owner
              : branchIds.every((b) => can(u, b, "notices:write")),
            "공지 작성 권한이 없습니다.",
            403,
          );
          data = {
            ...shared,
            title: text.max(200).parse(b.title),
            body: text.max(20000).parse(b.body),
            target,
            branchIds,
            pinned: b.pinned === true,
            status: z
              .enum(["임시 저장", "게시 중"])
              .parse(b.status ?? "임시 저장"),
            author: actor(u.id)!,
            publishedAt: b.status === "게시 중" ? now : null,
            canEdit: true,
          };
        }
        persist(r, data);
        store.idempotency[`${u.id}:${r}:${key}`] = {
          fingerprint: JSON.stringify(b),
          result: data,
          authorization: JSON.stringify(u),
        };
        store.persist();
        return view(r, id, u);
      }, 201),
    ),
    http.patch(
      `/api/${r}/:id`,
      respond((a, u) => modify(a, u, r, "")),
    ),
    ...[
      "status",
      ...(r === "facilities"
        ? ["inspection/complete"]
        : r === "inquiries"
          ? ["assignee", "answer"]
          : []),
    ].map((action) =>
      http.post(
        `/api/${r}/:id/${action}`,
        respond((a, u) => modify(a, u, r, action)),
      ),
    ),
  ],
);
const allowedBranches = (u: Employee) =>
  store.db.branches.filter((b) => can(u, b.id)).map((b) => b.id);
function resolveAssignee(id: unknown, branch: string) {
  if (!id) return null;
  const e = store.db.employees.find(
    (e) =>
      e.id === id &&
      e.status === "활성" &&
      e.memberships.some(
        (m) => m.branchId === branch && (!m.status || m.status === "활성"),
      ),
  );
  assert(e, "활성 직원을 선택하세요.", 422, "INVALID_ASSIGNEE");
  return { id: e.id, name: e.name };
}
async function modify(a: Args, u: Employee, r: R, action: string) {
  const row = allowed(a, r, u).find((x) => x.id === a.params.id);
  assert(row, "찾을 수 없습니다.", 404, "NOT_FOUND");
  const b = (await a.request.json()) as Record<string, unknown>;
  const key = a.request.headers.get("Idempotency-Key"),
    intent = `${u.id}:${r}:${row.id}:${key}`,
    prior = store.idempotency[intent];
  if ("openWork" in row)
    assert(
      action === "inspection/complete" ? row.canComplete : row.canEdit,
      "시설 처리 권한이 없습니다.",
      403,
    );
  else if ("pinned" in row)
    assert(row.canEdit, "공지 수정 권한이 없습니다.", 403);
  else if (action === "assignee")
    assert(row.canChangeAssignee, "담당자 변경 권한이 없습니다.", 403);
  if (action === "inspection/complete") {
    assert(key, "요청 키가 필요합니다.", 422);
    if (prior) {
      assert(
        prior.fingerprint === JSON.stringify(b),
        "다른 입력입니다.",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      return prior.result;
    }
  }
  if (version.parse(b.version) !== row.version)
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "최신값과 비교하세요.",
      undefined,
      row.version,
      `/api/${r}/${row.id}`,
    );
  const next = structuredClone(row);
  next.version++;
  next.updatedAt = store.now();
  if ("openWork" in next) {
    if (action === "inspection/complete") {
      const date = z.iso.date().parse(b.completedOn);
      assert(
        date <= businessDate(store.now()) &&
          (!next.lastInspectedOn || date >= next.lastInspectedOn),
        "점검일을 확인하세요.",
        422,
      );
      next.lastInspectedOn = date;
      next.lastInspection = {
        completedOn: date,
        result: z.object({ result: text.max(5000) }).parse(b).result,
        completedBy: actor(u.id),
      };
      next.status = z
        .enum(["정상", "점검 필요", "고장", "사용 중지"])
        .parse(b.facilityStatus);
      next.openWork = {
        ...next.openWork,
        id: crypto.randomUUID(),
        status: "대기",
        openedAt: store.now(),
      };
    } else {
      if (b.name !== undefined) next.name = text.max(120).parse(b.name);
      if (b.typeId !== undefined) {
        const t = allTypes().find((t) => t.id === b.typeId);
        assert(t, "유형을 선택하세요.", 422);
        next.type = t;
      }
      if (b.status !== undefined)
        next.status = z
          .enum(["정상", "점검 필요", "고장", "사용 중지"])
          .parse(b.status);
      if (b.workStatus !== undefined)
        next.openWork.status = z.enum(["대기", "진행 중"]).parse(b.workStatus);
      if (b.inspectionIntervalDays !== undefined)
        next.inspectionIntervalDays = z
          .number()
          .int()
          .positive()
          .parse(b.inspectionIntervalDays);
      if ("assigneeId" in b)
        next.openWork.assignee = resolveAssignee(b.assigneeId, next.branchId);
      for (const k of ["location", "description"] as const)
        if (k in b) next[k] = z.string().nullable().parse(b[k]);
    }
  } else if ("customer" in next) {
    if (action === "answer") {
      next.answer = text.max(20000).parse(b.answer);
      next.answeredBy = actor(u.id);
      next.answeredAt = store.now();
      next.status = "답변 완료";
    } else if (action === "status")
      next.status = z.enum(["접수", "처리 중"]).parse(b.status);
    else if (action === "assignee")
      next.assignee = resolveAssignee(b.assigneeId, next.branchId);
    else throw new DomainError(404, "NOT_FOUND", "지원하지 않는 요청입니다.");
    const raw = store.db.inquiries.find((x) => x.id === next.id)!;
    raw.collaborationEvents ??= [];
    raw.collaborationEvents.push({
      id: crypto.randomUUID(),
      actor: actor(u.id)!,
      oldStatus: row.status as S["InquiryStatus"],
      newStatus: next.status,
      message:
        action === "answer"
          ? next.answer
          : action === "assignee"
            ? `담당자: ${next.assignee?.name ?? "미지정"}`
            : null,
      at: store.now(),
    });
  } else {
    if (action === "status") {
      const s = z.enum(["게시 중", "게시 종료"]).parse(b.status);
      assert(
        s === next.status ||
          (s === "게시 중" && next.status !== "게시 중") ||
          (s === "게시 종료" && next.status === "게시 중"),
        "상태 전이를 확인하세요.",
        409,
        "INVALID_STATE",
      );
      next.status = s;
      if (s === "게시 중") next.publishedAt = store.now();
    } else {
      if (b.title !== undefined) next.title = text.max(200).parse(b.title);
      if (b.body !== undefined) next.body = text.max(20000).parse(b.body);
      if (b.pinned !== undefined) next.pinned = z.boolean().parse(b.pinned);
      if (b.target !== undefined)
        next.target = z.enum(["전체", "선택 지점"]).parse(b.target);
      if (next.target === "전체") next.branchIds = [];
      else if (b.branchIds !== undefined)
        next.branchIds = z.array(text).min(1).parse(b.branchIds);
      assert(
        next.target === "전체"
          ? u.owner
          : next.branchIds.every((b) => can(u, b, "notices:write")),
        "대상 지점 권한이 없습니다.",
        403,
      );
    }
  }
  persist(r, next);
  const result = view(r, next.id, u);
  if (action === "inspection/complete") {
    store.idempotency[intent] = {
      fingerprint: JSON.stringify(b),
      result,
      authorization: JSON.stringify(u),
    };
    store.persist();
  }
  return result;
}
export const collaborationHandlers = [
  http.post(
    "/api/facility-types",
    respond(async (a, u) => {
      assert(u.owner, "사장님만 유형을 등록할 수 있습니다.", 403, "FORBIDDEN");
      const body = z
        .object({
          name: text.max(80),
          defaultInspectionDays: z.number().int().positive(),
        })
        .parse(await a.request.json());
      const key = a.request.headers.get("Idempotency-Key");
      assert(key, "요청 키가 필요합니다.", 422);
      const intent = `${u.id}:facility-types:${key}`,
        prior = store.idempotency[intent];
      if (prior) {
        assert(
          prior.fingerprint === JSON.stringify(body),
          "다른 입력입니다.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        return prior.result;
      }
      assert(
        !allTypes().some((t) => t.name === body.name),
        "이미 등록된 유형입니다.",
        409,
        "DUPLICATE_FACILITY_TYPE",
      );
      const result = { ...body, id: crypto.randomUUID() };
      store.idempotency[intent] = {
        fingerprint: JSON.stringify(body),
        result,
        authorization: JSON.stringify(u),
      };
      store.persist();
      return result;
    }, 201),
  ),
  http.get(
    "/api/facility-types",
    respond(() => ({ items: allTypes() })),
  ),
  http.get(
    "/api/inquiries/:id/events",
    respond((a, u) => {
      assert(
        allowed(a, "inquiries", u).some((x) => x.id === a.params.id),
        "찾을 수 없습니다.",
        404,
      );
      return paginate(
        a,
        [
          ...(store.db.inquiries.find((x) => x.id === a.params.id)
            ?.collaborationEvents ?? []),
        ].reverse(),
      );
    }),
  ),
  ...handlers,
];
export {
  facility as facilityView,
  inquiry as inquiryView,
  notice as noticeView,
};
