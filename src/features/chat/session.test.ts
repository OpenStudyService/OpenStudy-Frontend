import { afterEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { chatApi } from "./api";
import {
  clearChatChannel,
  clearChatSession,
  reconcileOutgoing,
  transmit,
  useChatSession,
} from "./session";
import type { Outgoing } from "./session";
import { draftKey } from "./model";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
vi.mock("./api", () => ({ chatApi: { send: vi.fn() } }));
it("preserves a failed job for CSRF retry but clears it when channel access is denied", async () => {
  const query = new QueryClient(),
    key = draftKey(job.userId, job.scope, job.channelId);
  useChatSession.getState().setDraft(key, job.text);
  vi.mocked(chatApi.send).mockRejectedValueOnce(
    new ApiError(403, { code: "CSRF_INVALID", message: "요청 인증 확인" }),
  );
  await transmit(job, query);
  expect(useChatSession.getState().outgoing[0].state).toBe("failed");
  expect(useChatSession.getState().drafts[key]).toBe(job.text);
  vi.mocked(chatApi.send).mockRejectedValueOnce(
    new ApiError(403, { code: "SCOPE_DENIED", message: "참여 종료" }),
  );
  await transmit(job, query);
  expect(useChatSession.getState().outgoing).toEqual([]);
  expect(useChatSession.getState().drafts[key]).toBeUndefined();
  query.clear();
});
const job: Outgoing = {
  userId: "junho",
  scope: "gangnam",
  channelId: "gangnam",
  parentId: "",
  text: "보고",
  clientMessageId: "stable",
  state: "sending",
};
afterEach(() => {
  clearChatSession();
  vi.resetAllMocks();
});
it("preserves a failed attempt and uses its original key on retry", async () => {
  const query = new QueryClient();
  vi.mocked(chatApi.send).mockRejectedValueOnce(new Error("연결 실패"));
  useChatSession
    .getState()
    .setDraft(draftKey(job.userId, job.scope, job.channelId), job.text);
  await transmit(job, query);
  expect(useChatSession.getState().outgoing[0].state).toBe("failed");
  vi.mocked(chatApi.send).mockResolvedValue(
    new MockStore(false).db.messages[0],
  );
  await transmit(useChatSession.getState().outgoing[0], query);
  expect(
    vi.mocked(chatApi.send).mock.calls.map((call) => call[1].clientMessageId),
  ).toEqual(["stable", "stable"]);
  expect(
    useChatSession.getState().drafts[
      draftKey(job.userId, job.scope, job.channelId)
    ],
  ).toBe("");
  query.clear();
});
it("locks the composer synchronously and preserves a newer draft when an older send completes", async () => {
  let done!: (value: never) => void;
  vi.mocked(chatApi.send).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const query = new QueryClient(),
    request = transmit(job, query);
  await transmit({ ...job, clientMessageId: "double-click" }, query);
  expect(chatApi.send).toHaveBeenCalledTimes(1);
  const key = draftKey(job.userId, job.scope, job.channelId);
  useChatSession.getState().setDraft(key, "새 초안");
  done({} as never);
  await request;
  expect(useChatSession.getState().drafts[key]).toBe("새 초안");
  query.clear();
});
it("aborts and ignores late results after a channel loses access", async () => {
  let done!: (value: never) => void, signal!: AbortSignal;
  vi.mocked(chatApi.send).mockImplementation((_channel, _body, current) => {
    signal = current;
    return new Promise((resolve) => {
      done = resolve;
    });
  });
  const query = new QueryClient(),
    request = transmit(job, query);
  clearChatChannel(job.userId, job.scope, job.channelId);
  expect(signal.aborted).toBe(true);
  done({} as never);
  await request;
  expect(useChatSession.getState().outgoing).toEqual([]);
  query.clear();
});
it("reconciles a delivered message after a lost response without displaying a duplicate", async () => {
  const query = new QueryClient();
  vi.mocked(chatApi.send).mockRejectedValue(new Error("응답 유실"));
  await transmit(job, query);
  const original = new MockStore(false).db.messages[0];
  reconcileOutgoing(job.userId, job.scope, [
    {
      ...original,
      authorId: job.userId,
      channelId: job.channelId,
      parentId: job.parentId,
      clientMessageId: job.clientMessageId,
      text: job.text,
    },
  ]);
  expect(useChatSession.getState().outgoing).toEqual([]);
  query.clear();
});
