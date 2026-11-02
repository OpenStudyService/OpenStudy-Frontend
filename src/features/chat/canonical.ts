import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import type { Message, ResourceMap } from "../../shared/domain/schema";
import type { Channel, MessageFeed } from "./model";

const id = z.string().regex(/^[1-9]\d*$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const actor = z.object({ id, name: z.string() });
const card = z
  .object({
    accessible: z.boolean(),
    taskId: id.nullable(),
    branchId: id.nullable(),
    title: z.string().nullable(),
    status: z.enum(["할 일", "진행 중", "완료"]).nullable(),
    priority: z.enum(["낮음", "보통", "높음", "긴급"]).nullable(),
    assignee: actor.nullable(),
    dueAt: instant.nullable(),
  })
  .refine((v) =>
    v.accessible
      ? !!v.taskId && !!v.branchId && !!v.title && !!v.status && !!v.priority
      : [
          v.taskId,
          v.branchId,
          v.title,
          v.status,
          v.priority,
          v.assignee,
          v.dueAt,
        ].every((x) => x === null),
  );
const channel = z
  .object({
    id,
    kind: z.enum(["전체", "지점"]),
    branchId: id.nullable(),
    name: z.string(),
    description: z.string().nullable(),
    memberCount: count,
    joined: z.boolean(),
    unreadCount: count,
    lastReadMessageId: id.nullable(),
    lastMessageAt: instant.nullable(),
    canManage: z.boolean(),
    version: count,
    createdAt: instant,
  })
  .refine((v) => (v.kind === "전체") === (v.branchId === null));
const message = z
  .object({
    id,
    channelId: id,
    sender: actor,
    parentId: id.nullable(),
    kind: z.enum(["텍스트", "업무 카드"]),
    body: z.string().nullable(),
    task: card.nullable(),
    clientMessageKey: z.string().min(1),
    replyCount: count,
    sentAt: instant,
  })
  .refine((v) => (v.kind === "업무 카드") === (v.task !== null));
export type CanonicalMessage = Message & {
  canonicalId: string;
  senderName: string;
  replyCount: number;
  taskCard: z.infer<typeof card> | null;
};
export type CanonicalChannel = Channel & {
  memberNames: Record<string, string>;
  memberCount: number;
  joined: boolean;
  canManage: boolean;
  lastReadMessageId: string | null;
};
export const canonicalMessage = (
  value: Message,
): CanonicalMessage | undefined =>
  "canonicalId" in value ? (value as CanonicalMessage) : undefined;
export const canonicalChannel = (
  value: ResourceMap["channels"],
): CanonicalChannel | undefined =>
  "joined" in value ? (value as CanonicalChannel) : undefined;
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "채팅 응답을 확인하지 못했어요. 다시 조회해 주세요.",
    });
  return parsed.data;
}
const channelPath = (value: string) => `/channels/${encodeURIComponent(value)}`;
export class PartialChannelSaveError extends ApiError {
  constructor(failure: ApiError) {
    super(
      failure.status,
      {
        ...failure.detail,
        message: `채널 변경이 일부 저장됐을 수 있어요. 최신 내용을 확인해 주세요. ${failure.detail.message}`,
      },
      failure.retryAfter,
    );
  }
}
function mapMessage(value: z.infer<typeof message>): CanonicalMessage {
  return {
    id: value.id,
    canonicalId: value.id,
    version: 0,
    branchId: "all",
    createdAt: value.sentAt,
    updatedAt: value.sentAt,
    channelId: value.channelId,
    authorId: value.sender.id,
    senderName: value.sender.name,
    text: value.body ?? "",
    parentId: value.parentId ?? "",
    taskId: value.task?.taskId ?? "",
    clientMessageId: value.clientMessageKey,
    sequence: 0,
    replyCount: value.replyCount,
    taskCard: value.task,
  };
}
async function members(channelId: string, signal: AbortSignal) {
  return checked(
    z.object({
      items: z.array(z.object({ employee: actor, joinedAt: instant })),
    }),
    await api<unknown>(`${channelPath(channelId)}/members`, { signal }),
  ).items;
}
async function mapChannel(
  value: z.infer<typeof channel>,
  signal: AbortSignal,
): Promise<CanonicalChannel> {
  const people = await members(value.id, signal);
  return {
    id: value.id,
    version: value.version,
    name: value.name,
    description: value.description ?? "",
    branchId: value.branchId ?? "all",
    kind: "channel",
    status: "활성",
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
    participantIds: people.map((p) => p.employee.id),
    memberNames: Object.fromEntries(
      people.map((p) => [p.employee.id, p.employee.name]),
    ),
    reads: {},
    unread: value.unreadCount,
    memberCount: value.memberCount,
    joined: value.joined,
    canManage: value.canManage,
    lastReadMessageId: value.lastReadMessageId,
  };
}
export const canonicalChatApi = {
  async channel(value: string, signal: AbortSignal) {
    return mapChannel(
      checked(channel, await api<unknown>(channelPath(value), { signal })),
      signal,
    );
  },
  async channels(scope: string, signal: AbortSignal) {
    const result = checked(
      z.object({ items: z.array(channel) }),
      await api<unknown>(`/channels?${queryString({ scope })}`, { signal }),
    );
    return Promise.all(result.items.map((row) => mapChannel(row, signal)));
  },
  async managed(scope: string, signal: AbortSignal) {
    const items: CanonicalChannel[] = [];
    let page = 1;
    let total: number;
    do {
      const result = checked(
        z.object({
          items: z.array(channel),
          meta: z.object({
            page: count.min(1),
            pageSize: count.min(1),
            total: count,
          }),
        }),
        await api<unknown>(
          `/channels/manageable?${queryString({ scope, page, pageSize: 100 })}`,
          { signal },
        ),
      );
      if (
        result.meta.page !== page ||
        (!result.items.length && items.length < result.meta.total)
      )
        throw new ApiError(0, {
          code: "INVALID_RESPONSE",
          message: "채널 목록의 페이지 정보를 확인해 주세요.",
        });
      total = result.meta.total;
      items.push(
        ...(await Promise.all(
          result.items.map((row) => mapChannel(row, signal)),
        )),
      );
      page++;
    } while (items.length < total);
    return { items, page: 1, pageSize: 100, total };
  },
  async candidates(branchId: string, signal: AbortSignal) {
    return checked(
      z.object({ items: z.array(actor) }),
      await api<unknown>(
        `/channels/member-candidates?${queryString({ branchId: branchId === "all" ? undefined : branchId })}`,
        { signal },
      ),
    ).items;
  },
  async messages(
    channelId: string,
    parent: string,
    signal: AbortSignal,
    before?: string,
  ): Promise<MessageFeed> {
    const path = parent
      ? `${channelPath(channelId)}/messages/${encodeURIComponent(parent)}/replies`
      : `${channelPath(channelId)}/messages`;
    const result = checked(
      z
        .object({
          items: z.array(message),
          hasMore: z.boolean(),
          nextCursor: id.nullable(),
        })
        .refine((v) => v.hasMore === (v.nextCursor !== null)),
      await api<unknown>(`${path}?${queryString({ before, limit: 50 })}`, {
        signal,
      }),
    );
    if (
      result.items.some(
        (row) =>
          row.channelId !== channelId || row.parentId !== (parent || null),
      )
    )
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "요청한 대화와 응답이 일치하지 않아요.",
      });
    return {
      items: result.items.map(mapMessage),
      nextCursor: result.nextCursor ?? undefined,
    };
  },
  async parent(channelId: string, messageId: string, signal: AbortSignal) {
    const result = checked(
      message,
      await api<unknown>(
        `${channelPath(channelId)}/messages/${encodeURIComponent(messageId)}`,
        { signal },
      ),
    );
    if (result.channelId !== channelId || result.id !== messageId)
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "요청한 메시지와 응답이 일치하지 않아요.",
      });
    return mapMessage(result);
  },
  async send(
    channelId: string,
    body: {
      text: string;
      parentId: string;
      taskId: string;
      clientMessageId: string;
    },
    signal: AbortSignal,
  ) {
    const input:
      | components["schemas"]["MessageCreate"]
      | components["schemas"]["TaskCardCreate"] = {
      clientMessageKey: body.clientMessageId,
      ...(body.text ? { text: body.text } : {}),
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.taskId ? { taskId: body.taskId } : {}),
    } as components["schemas"]["MessageCreate"];
    const result = checked(
      message,
      await api<unknown>(
        `${channelPath(channelId)}/${body.taskId ? "task-cards" : "messages"}`,
        { method: "POST", body: input, signal },
      ),
    );
    if (
      result.channelId !== channelId ||
      result.clientMessageKey !== body.clientMessageId
    )
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "메시지 전송 결과를 확인해 주세요.",
      });
    return mapMessage(result);
  },
  async saveChannel(
    value: string | undefined,
    body: object,
    signal: AbortSignal,
    key: string,
  ) {
    const input = body as {
      branchId?: string;
      name?: string;
      description?: string;
      participantIds?: string[];
      version?: number;
    };
    if (!value) {
      const result = checked(
        channel,
        await api<unknown>("/channels", {
          method: "POST",
          body: {
            kind: input.branchId === "all" ? "전체" : "지점",
            ...(input.branchId !== "all" ? { branchId: input.branchId } : {}),
            name: input.name,
            description: input.description ?? null,
            memberIds: input.participantIds ?? [],
          },
          signal,
          key,
        }),
      );
      return mapChannel(result, signal);
    }
    let version = input.version;
    const metadata =
      input.name !== undefined || input.description !== undefined;
    if (metadata) {
      const result = checked(
        channel,
        await api<unknown>(channelPath(value), {
          method: "PATCH",
          body: {
            version,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
          },
          signal,
        }),
      );
      version = result.version;
    }
    if (input.participantIds !== undefined) {
      try {
        await api<unknown>(`${channelPath(value)}/members`, {
          method: "PUT",
          body: { version, employeeIds: input.participantIds },
          signal,
        });
      } catch (failure) {
        if (metadata && failure instanceof ApiError)
          throw new PartialChannelSaveError(
            new ApiError(failure.status, {
              ...failure.detail,
              message: `채널 이름·설명은 저장됐지만 참여자 변경을 확인하지 못했어요. 최신 내용을 확인해 주세요. ${failure.detail.message}`,
            }),
          );
        throw failure;
      }
    }
    try {
      return await canonicalChatApi.channel(value, signal);
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (metadata || input.participantIds !== undefined)
      )
        throw new PartialChannelSaveError(failure);
      throw failure;
    }
  },
};
