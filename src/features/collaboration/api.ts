import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";

type S = components["schemas"];
export type Resource = "facilities" | "inquiries" | "notices";
export type Detail = S["Facility"] | S["Inquiry"] | S["Notice"];
export type Item =
  S["FacilityListItem"] | S["InquiryListItem"] | S["NoticeListItem"];
const id = z.string().min(1),
  actor = z.object({ id, name: z.string() });
const common = {
  id,
  version: z.number().int().nonnegative(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
};
const facility = z.object({
  ...common,
  branchId: id,
  name: z.string(),
  type: z.object({ id, name: z.string(), defaultInspectionDays: z.number() }),
  location: z.string().nullable(),
  status: z.enum(["정상", "점검 필요", "고장", "사용 중지"]),
  inspectionIntervalDays: z.number(),
  lastInspectedOn: z.string().nullable(),
  nextInspectionOn: z.string(),
  inspectionDue: z.boolean(),
  openWork: z.object({
    id,
    status: z.enum(["대기", "진행 중"]),
    assignee: actor.nullable(),
    openedAt: z.string(),
  }),
  canEdit: z.boolean(),
  canComplete: z.boolean(),
});
const inquiry = z.object({
  ...common,
  branchId: id,
  subject: z.string(),
  customer: z.object({ id, name: z.string(), memberNo: z.string() }),
  source: z.enum(["방문", "전화", "기타"]),
  status: z.enum(["접수", "처리 중", "답변 완료"]),
  assignee: actor.nullable(),
  createdBy: actor,
  answeredAt: z.string().nullable(),
  canChangeAssignee: z.boolean(),
});
const notice = z.object({
  ...common,
  title: z.string(),
  author: actor,
  target: z.enum(["전체", "선택 지점"]),
  branchIds: z.array(id),
  status: z.enum(["임시 저장", "게시 중", "게시 종료"]),
  pinned: z.boolean(),
  publishedAt: z.string().nullable(),
  canEdit: z.boolean(),
});
const lists = { facilities: facility, inquiries: inquiry, notices: notice };
const details = {
  facilities: facility.extend({
    description: z.string().nullable(),
    lastInspection: z
      .object({
        completedOn: z.string(),
        result: z.string(),
        completedBy: actor.nullable(),
      })
      .nullable(),
  }),
  inquiries: inquiry.extend({
    body: z.string(),
    answer: z.string().nullable(),
    answeredBy: actor.nullable(),
  }),
  notices: notice.extend({ body: z.string() }),
};
export function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "서버 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
    });
  return result.data as T;
}
export const meta = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export const recordApi = {
  async list(
    resource: Resource,
    scope: string,
    search: string,
    signal: AbortSignal,
  ) {
    const p = new URLSearchParams(search);
    p.set("scope", scope);
    return parse<{ items: Item[]; meta: S["PageMeta"] }>(
      z.object({ items: z.array(lists[resource]), meta }),
      await api(`/${resource}?${p}`, { signal }),
    );
  },
  async detail(
    resource: Resource,
    scope: string,
    recordId: string,
    signal: AbortSignal,
  ) {
    const value = parse<Detail>(
      details[resource],
      await api(
        `/${resource}/${encodeURIComponent(recordId)}?${queryString({ scope })}`,
        { signal },
      ),
    );
    if (value.id !== recordId)
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "조회 대상과 응답이 다릅니다.",
      });
    return value;
  },
  async write(
    resource: Resource,
    scope: string,
    recordId: string | undefined,
    action: string,
    body: unknown,
    signal: AbortSignal,
    key: string,
  ) {
    const suffix = recordId
      ? `/${encodeURIComponent(recordId)}${action ? `/${action}` : ""}`
      : "";
    const value = await api(`/${resource}${suffix}?${queryString({ scope })}`, {
      method: !recordId || action ? "POST" : "PATCH",
      body,
      signal,
      ...(!recordId || action === "inspection/complete" ? { key } : {}),
    });
    const result = parse<Detail>(details[resource], value);
    if (recordId && result.id !== recordId)
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "저장 대상과 응답이 다릅니다.",
      });
    return result;
  },
  async summary(
    resource: "facilities" | "inquiries",
    scope: string,
    q: string,
    signal: AbortSignal,
  ) {
    const n = z.number().int().nonnegative();
    const counts =
      resource === "facilities"
        ? z.object({
            total: n,
            normal: n,
            checkNeeded: n,
            broken: n,
            outOfService: n,
            inspectionDue: n,
          })
        : z.object({
            total: n,
            received: n,
            inProgress: n,
            answered: n,
            unresolved: n,
          });
    return parse<{ totals: Record<string, number> }>(
      z.object({ asOf: z.string(), totals: counts }),
      await api(`/${resource}/summary?${queryString({ scope, q })}`, {
        signal,
      }),
    );
  },
  async types(signal: AbortSignal) {
    return parse<S["FacilityTypeList"]>(
      z.object({
        items: z.array(
          z.object({ id, name: z.string(), defaultInspectionDays: z.number() }),
        ),
      }),
      await api("/facility-types", { signal }),
    );
  },
  async events(
    scope: string,
    recordId: string,
    page: number,
    signal: AbortSignal,
  ) {
    return parse<S["InquiryEventPage"]>(
      z.object({
        items: z.array(
          z.object({
            id,
            actor,
            oldStatus: z.string().nullable(),
            newStatus: z.string(),
            message: z.string().nullable(),
            at: z.string(),
          }),
        ),
        meta,
      }),
      await api(
        `/inquiries/${encodeURIComponent(recordId)}/events?${queryString({ scope, page, pageSize: 20 })}`,
        { signal },
      ),
    );
  },
};
