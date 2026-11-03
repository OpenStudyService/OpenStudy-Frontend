import { api, MOCK, queryString } from "../../shared/api/client";
import { asArray, asPage } from "../../shared/api/read-model";
import { schemas } from "../../shared/domain/schema";
import type { Message, ResourceMap } from "../../shared/domain/schema";
import type { Channel, MessageFeed } from "./model";
import { canonicalChatApi } from "./canonical";

// Preserve the existing demo transport; live responses use the canonical M7 adapter.
export const chatApi = {
  channel(id: string, scope: string, signal: AbortSignal) {
    if (!MOCK) return canonicalChatApi.channel(id, signal);
    return api<ResourceMap["channels"]>(
      `/channels/${encodeURIComponent(id)}?${queryString({ scope })}`,
      { signal },
    );
  },
  async channels(scope: string, signal: AbortSignal) {
    if (!MOCK) return canonicalChatApi.channels(scope, signal);
    return asArray<Channel>(
      await api(`/chat/channels?${queryString({ scope })}`, { signal }),
    ).filter((channel) => MOCK || channel.kind !== "dm");
  },
  async managed(scope: string, signal: AbortSignal) {
    if (!MOCK) return canonicalChatApi.managed(scope, signal);
    const first = asPage<ResourceMap["channels"]>(
      await api(`/channels?${queryString({ scope, page: 1, pageSize: 100 })}`, {
        signal,
      }),
    );
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page++) {
      const next = asPage<ResourceMap["channels"]>(
        await api(
          `/channels?${queryString({ scope, page, pageSize: first.pageSize })}`,
          { signal },
        ),
      );
      if (!next.items.length)
        throw new Error("채널 목록의 페이지 정보를 확인해 주세요.");
      items.push(...next.items);
    }
    return { ...first, items };
  },
  async candidates(branch: string, signal: AbortSignal) {
    if (!MOCK) return canonicalChatApi.candidates(branch, signal);
    const value = await api<{ employees?: unknown[] }>(
      `/lookups?${queryString({ scope: branch })}`,
      { signal },
    );
    return (value?.employees ?? []).flatMap((row) => {
      const parsed = schemas.employees.safeParse(row);
      return parsed.success &&
        parsed.data.status === "활성" &&
        (branch === "all" ||
          parsed.data.owner ||
          parsed.data.memberships.some(
            (m) => m.branchId === branch && (!m.status || m.status === "활성"),
          ))
        ? [parsed.data]
        : [];
    });
  },
  async messages(
    channel: string,
    parent: string,
    signal: AbortSignal,
    before?: string,
  ): Promise<MessageFeed> {
    if (!MOCK)
      return canonicalChatApi.messages(channel, parent, signal, before);
    const params = new URLSearchParams({ parent });
    if (before) params.set("before", before);
    return asPage<Message>(
      await api(`/chat/${encodeURIComponent(channel)}/messages?${params}`, {
        signal,
      }),
    );
  },
  parent(id: string, scope: string, signal: AbortSignal, channelId?: string) {
    if (!MOCK) {
      if (!channelId)
        return Promise.reject(new Error("메시지를 조회할 채널이 필요해요."));
      return canonicalChatApi.parent(channelId, id, signal);
    }
    return api<Message>(
      `/messages/${encodeURIComponent(id)}?${queryString({ scope })}`,
      { signal },
    );
  },
  send(
    channel: string,
    body: {
      text: string;
      parentId: string;
      taskId: string;
      clientMessageId: string;
    },
    signal: AbortSignal,
  ) {
    if (!MOCK) return canonicalChatApi.send(channel, body, signal);
    return api<Message>(`/chat/${encodeURIComponent(channel)}/messages`, {
      method: "POST",
      body,
      key: body.clientMessageId,
      signal,
    });
  },
  read(
    channel: string,
    parentId: string,
    position: number | string,
    signal: AbortSignal,
  ) {
    if (!MOCK) {
      if (typeof position !== "string")
        return Promise.reject(new Error("정본 메시지 ID가 필요해요."));
      return canonicalChatApi.read(channel, parentId, position, signal);
    }
    return api(`/chat/${encodeURIComponent(channel)}/read`, {
      method: "POST",
      body: { parentId, sequence: position },
      signal,
    });
  },
  saveChannel(
    id: string | undefined,
    body: object,
    signal: AbortSignal,
    key: string,
  ) {
    if (!MOCK) return canonicalChatApi.saveChannel(id, body, signal, key);
    return api<ResourceMap["channels"]>(
      `/channels${id ? `/${encodeURIComponent(id)}` : ""}`,
      { method: id ? "PATCH" : "POST", body, signal, key },
    );
  },
};
