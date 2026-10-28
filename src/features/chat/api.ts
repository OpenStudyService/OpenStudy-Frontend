import { api, MOCK, queryString } from "../../shared/api/client";
import { asArray, asPage } from "../../shared/api/read-model";
import { schemas } from "../../shared/domain/schema";
import type { Message, ResourceMap } from "../../shared/domain/schema";
import type { Channel, MessageFeed } from "./model";

// Existing demo transport only. Backend #74 must define canonical DTOs and per-thread receipts.
export const chatApi = {
  channel(id: string, scope: string, signal: AbortSignal) {
    return api<ResourceMap["channels"]>(
      `/channels/${encodeURIComponent(id)}?${queryString({ scope })}`,
      { signal },
    );
  },
  async channels(scope: string, signal: AbortSignal) {
    return asArray<Channel>(
      await api(`/chat/channels?${queryString({ scope })}`, { signal }),
    ).filter((channel) => MOCK || channel.kind !== "dm");
  },
  async managed(scope: string, signal: AbortSignal) {
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
    const params = new URLSearchParams({ parent });
    if (before) params.set("before", before);
    return asPage<Message>(
      await api(`/chat/${encodeURIComponent(channel)}/messages?${params}`, {
        signal,
      }),
    );
  },
  parent(id: string, scope: string, signal: AbortSignal) {
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
    sequence: number,
    signal: AbortSignal,
  ) {
    // Do not send a made-up read contract to a live server before #74 is ready.
    if (!MOCK)
      return Promise.reject(new Error("읽음 상태 API 연결을 준비 중입니다."));
    return api(`/chat/${encodeURIComponent(channel)}/read`, {
      method: "POST",
      body: { parentId, sequence },
      signal,
    });
  },
  saveChannel(
    id: string | undefined,
    body: object,
    signal: AbortSignal,
    key: string,
  ) {
    return api<ResourceMap["channels"]>(
      `/channels${id ? `/${encodeURIComponent(id)}` : ""}`,
      { method: id ? "PATCH" : "POST", body, signal, key },
    );
  },
};
