import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/client";
import { chatApi } from "./api";
import { draftKey } from "./model";
import type { Message } from "../../shared/domain/schema";

export interface Outgoing {
  userId: string;
  scope: string;
  channelId: string;
  parentId: string;
  text: string;
  clientMessageId: string;
  state: "sending" | "failed";
  error?: string;
}
interface ChatSession {
  drafts: Record<string, string>;
  outgoing: Outgoing[];
  setDraft: (key: string, text: string) => void;
  remove: (id: string) => void;
}
export const useChatSession = create<ChatSession>((set) => ({
  drafts: {},
  outgoing: [],
  setDraft: (key, text) =>
    set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
  remove: (id) =>
    set((s) => ({
      outgoing: s.outgoing.filter((j) => j.clientMessageId !== id),
    })),
}));
const requests = new Map<
  string,
  { job: Outgoing; controller: AbortController }
>();
let epoch = 0;
export function clearChatSession() {
  epoch++;
  requests.forEach((r) => r.controller.abort());
  requests.clear();
  useChatSession.setState({ drafts: {}, outgoing: [] });
}
export function clearChatChannel(
  userId: string,
  scope: string,
  channelId: string,
) {
  for (const [key, r] of requests)
    if (
      r.job.userId === userId &&
      r.job.scope === scope &&
      r.job.channelId === channelId
    ) {
      r.controller.abort();
      requests.delete(key);
    }
  useChatSession.setState((s) => ({
    outgoing: s.outgoing.filter(
      (j) =>
        j.userId !== userId || j.scope !== scope || j.channelId !== channelId,
    ),
    drafts: Object.fromEntries(
      Object.entries(s.drafts).filter(([key]) => {
        const parts = JSON.parse(key);
        return (
          parts[0] !== userId || parts[1] !== scope || parts[2] !== channelId
        );
      }),
    ),
  }));
}
export async function transmit(job: Outgoing, query: QueryClient) {
  if (requests.has(job.clientMessageId)) return;
  if (
    [...requests.values()].some(
      (r) =>
        r.job.userId === job.userId &&
        r.job.scope === job.scope &&
        r.job.channelId === job.channelId &&
        r.job.parentId === job.parentId,
    )
  )
    return;
  const controller = new AbortController(),
    started = epoch;
  requests.set(job.clientMessageId, { job, controller });
  useChatSession.setState((s) => ({
    outgoing: [
      ...s.outgoing.filter((j) => j.clientMessageId !== job.clientMessageId),
      { ...job, state: "sending", error: undefined },
    ],
  }));
  try {
    await chatApi.send(
      job.channelId,
      {
        text: job.text,
        parentId: job.parentId,
        taskId: "",
        clientMessageId: job.clientMessageId,
      },
      controller.signal,
    );
    controller.signal.throwIfAborted();
    if (started !== epoch) return;
    useChatSession.getState().remove(job.clientMessageId);
    const key = draftKey(job.userId, job.scope, job.channelId, job.parentId);
    if (useChatSession.getState().drafts[key]?.trim() === job.text)
      useChatSession.getState().setDraft(key, "");
    void query.invalidateQueries({
      queryKey: ["data", job.userId, job.scope, "chat"],
    });
  } catch (error) {
    if (controller.signal.aborted || started !== epoch) return;
    if (
      error instanceof ApiError &&
      [401, 403].includes(error.status) &&
      error.detail.code !== "CSRF_INVALID"
    ) {
      clearChatChannel(job.userId, job.scope, job.channelId);
      void query.invalidateQueries({
        queryKey: ["data", job.userId, job.scope, "chat", "channels"],
      });
      return;
    }
    useChatSession.setState((s) => ({
      outgoing: s.outgoing.map((j) =>
        j.clientMessageId === job.clientMessageId
          ? { ...j, state: "failed", error: (error as Error).message }
          : j,
      ),
    }));
  } finally {
    if (requests.get(job.clientMessageId)?.controller === controller)
      requests.delete(job.clientMessageId);
  }
}
export function reconcileOutgoing(
  userId: string,
  scope: string,
  messages: Message[],
) {
  for (const job of useChatSession.getState().outgoing) {
    if (
      job.userId !== userId ||
      job.scope !== scope ||
      !messages.some(
        (m) =>
          m.authorId === userId &&
          m.clientMessageId === job.clientMessageId &&
          m.channelId === job.channelId &&
          m.parentId === job.parentId &&
          m.text === job.text,
      )
    )
      continue;
    requests.get(job.clientMessageId)?.controller.abort();
    requests.delete(job.clientMessageId);
    useChatSession.getState().remove(job.clientMessageId);
    const key = draftKey(userId, scope, job.channelId, job.parentId);
    if (useChatSession.getState().drafts[key]?.trim() === job.text)
      useChatSession.getState().setDraft(key, "");
  }
}
