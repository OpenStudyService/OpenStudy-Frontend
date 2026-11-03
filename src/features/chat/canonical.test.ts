import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
import { api, ApiError } from "../../shared/api/client";
import {
  canonicalChatApi,
  canonicalMessage,
  PartialChannelSaveError,
} from "./canonical";
const request = vi.mocked(api),
  signal = new AbortController().signal;
const at = "2026-11-02T10:00:00Z";
const message = {
  id: "9007199254740993",
  channelId: "1",
  sender: { id: "2", name: "발신자" },
  parentId: null,
  kind: "텍스트",
  body: "<script>alert(1)</script>",
  task: null,
  clientMessageKey: "message-key",
  replyCount: 2,
  threadUnreadCount: 2,
  threadLastReadMessageId: null,
  sentAt: at,
};
const channel = {
  id: "1",
  kind: "지점",
  branchId: "3",
  name: "채널",
  description: null,
  memberCount: 1,
  joined: true,
  unreadCount: 4,
  mainUnreadCount: 2,
  replyUnreadCount: 2,
  lastReadMessageId: "9007199254740992",
  lastMessageAt: at,
  canManage: true,
  version: 0,
  createdAt: at,
};
const members = {
  items: [{ employee: { id: "2", name: "발신자" }, joinedAt: at }],
};
beforeEach(() => request.mockReset());
const receipt = {
  lastReadMessageId: "9007199254740995",
  lastReadAt: at,
  unreadCount: 3,
  mainUnreadCount: 1,
  replyUnreadCount: 2,
};
it("sends an exact bigint root ID without an idempotency key and accepts a later comparison-only position", async () => {
  request.mockResolvedValue(receipt);
  await canonicalChatApi.read("1", "", "9007199254740993", signal);
  expect(request).toHaveBeenCalledWith("/channels/1/read", {
    method: "POST",
    body: { messageId: "9007199254740993" },
    signal,
  });
});
it("addresses only the opened thread and sends its replyId", async () => {
  request.mockResolvedValue({
    ...receipt,
    messageId: "9",
    threadUnreadCount: 1,
  });
  await canonicalChatApi.read("1", "9", "9007199254740994", signal);
  expect(request).toHaveBeenCalledWith("/channels/1/messages/9/read", {
    method: "POST",
    body: { replyId: "9007199254740994" },
    signal,
  });
});
it.each([
  { ...receipt, unreadCount: 99, messageId: "9", threadUnreadCount: 1 },
  { ...receipt, messageId: "8", threadUnreadCount: 1 },
  { ...receipt, messageId: "9", threadUnreadCount: 3 },
  { ...receipt, messageId: "9" },
  {
    ...receipt,
    lastReadMessageId: "9007199254740992",
    messageId: "9",
    threadUnreadCount: 1,
  },
])(
  "rejects malformed, mismatched or regressing thread receipts",
  async (value) => {
    request.mockResolvedValue(value);
    await expect(
      canonicalChatApi.read("1", "9", "9007199254740993", signal),
    ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  },
);
it("requires split channel counts instead of defaulting a partial old contract to zero", async () => {
  request.mockResolvedValue({
    items: [{ ...channel, mainUnreadCount: undefined }],
  });
  await expect(canonicalChatApi.channels("all", signal)).rejects.toThrow();
  request.mockResolvedValue({ items: [{ ...channel, unreadCount: 7 }] });
  await expect(canonicalChatApi.channels("all", signal)).rejects.toThrow();
});
it("requires null thread fields on replies and preserves a baseline from another thread as an opaque position", async () => {
  request.mockResolvedValue({
    ...message,
    threadLastReadMessageId: "9007199254741999",
  });
  expect(
    canonicalMessage(await canonicalChatApi.parent("1", message.id, signal))
      ?.threadLastReadMessageId,
  ).toBe("9007199254741999");
  request.mockResolvedValue({
    items: [{ ...message, parentId: "9" }],
    hasMore: false,
    nextCursor: null,
  });
  await expect(canonicalChatApi.messages("1", "9", signal)).rejects.toThrow();
});
it("maps canonical feed without precision loss and retains sender/reply metadata and plaintext", async () => {
  request.mockResolvedValue({
    items: [message],
    hasMore: false,
    nextCursor: null,
  });
  const result = await canonicalChatApi.messages("1", "", signal);
  expect(request).toHaveBeenCalledWith("/channels/1/messages?limit=50", {
    signal,
  });
  expect(result.items[0]).toMatchObject({
    id: message.id,
    canonicalId: message.id,
    sequence: 0,
    senderName: "발신자",
    replyCount: 2,
    text: message.body,
  });
  expect(canonicalMessage(result.items[0])?.taskCard).toBeNull();
});
it("routes thread pages and uses exact opaque before IDs", async () => {
  request.mockResolvedValue({
    items: [
      {
        ...message,
        parentId: "9",
        threadUnreadCount: null,
        threadLastReadMessageId: null,
      },
    ],
    hasMore: true,
    nextCursor: message.id,
  });
  await canonicalChatApi.messages("1", "9", signal, "9007199254740995");
  expect(request.mock.calls[0][0]).toBe(
    "/channels/1/messages/9/replies?before=9007199254740995&limit=50",
  );
});
it("rejects wrong channel/thread feed, malformed paging and leaked inaccessible card data", async () => {
  for (const value of [
    {
      items: [{ ...message, channelId: "9" }],
      hasMore: false,
      nextCursor: null,
    },
    {
      items: [{ ...message, parentId: "9" }],
      hasMore: false,
      nextCursor: null,
    },
    { items: [message], hasMore: true, nextCursor: null },
    {
      items: [
        {
          ...message,
          kind: "업무 카드",
          task: {
            accessible: false,
            taskId: "9",
            branchId: null,
            title: null,
            status: null,
            priority: null,
            assignee: null,
            dueAt: null,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
  ]) {
    request.mockResolvedValue(value);
    await expect(
      canonicalChatApi.messages("1", "", signal),
    ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  }
});
it("preserves inaccessible card presence without inventing a task identifier", async () => {
  request.mockResolvedValue({
    ...message,
    kind: "업무 카드",
    task: {
      accessible: false,
      taskId: null,
      branchId: null,
      title: null,
      status: null,
      priority: null,
      assignee: null,
      dueAt: null,
    },
  });
  const result = await canonicalChatApi.parent("1", message.id, signal);
  expect(result.taskId).toBe("");
  expect(result.taskCard).toMatchObject({ accessible: false });
});
it("posts canonical message keys in the body and separates task-card sharing", async () => {
  request.mockResolvedValue(message);
  await canonicalChatApi.send(
    "1",
    {
      text: "hello",
      parentId: "9",
      taskId: "",
      clientMessageId: "message-key",
    },
    signal,
  );
  expect(request).toHaveBeenLastCalledWith("/channels/1/messages", {
    method: "POST",
    body: { text: "hello", parentId: "9", clientMessageKey: "message-key" },
    signal,
  });
  await canonicalChatApi.send(
    "1",
    { text: "", parentId: "", taskId: "7", clientMessageId: "message-key" },
    signal,
  );
  expect(request).toHaveBeenLastCalledWith("/channels/1/task-cards", {
    method: "POST",
    body: { taskId: "7", clientMessageKey: "message-key" },
    signal,
  });
});
it("maps actual membership and zero version without synthesizing authorization from counts", async () => {
  request
    .mockResolvedValueOnce({ items: [channel] })
    .mockResolvedValueOnce(members);
  const result = await canonicalChatApi.channels("3", signal);
  expect(result[0]).toMatchObject({
    participantIds: ["2"],
    version: 0,
    branchId: "3",
    unread: 4,
    joined: true,
  });
});
it("creates global channels with a stable idempotency key and no branchId field", async () => {
  request
    .mockResolvedValueOnce({ ...channel, kind: "전체", branchId: null })
    .mockResolvedValueOnce(members);
  await canonicalChatApi.saveChannel(
    undefined,
    { branchId: "all", name: "전체", description: "", participantIds: ["2"] },
    signal,
    "same-key",
  );
  expect(request.mock.calls[0]).toEqual([
    "/channels",
    {
      method: "POST",
      body: { kind: "전체", name: "전체", description: "", memberIds: ["2"] },
      signal,
      key: "same-key",
    },
  ]);
});
it("uses the metadata response version for separate member replacement, then rereads the result", async () => {
  request
    .mockResolvedValueOnce({ ...channel, version: 1 })
    .mockResolvedValueOnce(members)
    .mockResolvedValueOnce({ ...channel, version: 2 })
    .mockResolvedValueOnce(members);
  const result = await canonicalChatApi.saveChannel(
    "1",
    { version: 0, name: "new", participantIds: ["2"] },
    signal,
    "unused",
  );
  expect(request.mock.calls[1]).toEqual([
    "/channels/1/members",
    { method: "PUT", body: { version: 1, employeeIds: ["2"] }, signal },
  ]);
  expect(result.version).toBe(2);
});
it("reports partial metadata success when member replacement fails", async () => {
  request
    .mockResolvedValueOnce({ ...channel, version: 1 })
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "VERSION_CONFLICT",
        message: "충돌",
        latestVersion: 2,
        reloadUrl: "/api/channels/1",
      }),
    );
  await expect(
    canonicalChatApi.saveChannel(
      "1",
      { version: 0, name: "new", participantIds: ["2"] },
      signal,
      "unused",
    ),
  ).rejects.toMatchObject({
    status: 409,
    detail: {
      latestVersion: 2,
      message: expect.stringContaining("이름·설명은 저장됐지만"),
    },
  });
});
it("marks a failed result reread after member replacement as partial, while preserving abort", async () => {
  request
    .mockResolvedValueOnce(members)
    .mockRejectedValueOnce(
      new ApiError(503, { code: "UNAVAILABLE", message: "재조회 실패" }),
    );
  await expect(
    canonicalChatApi.saveChannel(
      "1",
      { version: 0, participantIds: ["2"] },
      signal,
      "unused",
    ),
  ).rejects.toBeInstanceOf(PartialChannelSaveError);
  request.mockReset();
  const abort = new DOMException("Aborted", "AbortError");
  request
    .mockResolvedValueOnce({ ...channel, version: 1 })
    .mockRejectedValueOnce(abort);
  await expect(
    canonicalChatApi.saveChannel(
      "1",
      { version: 0, name: "new", participantIds: ["2"] },
      signal,
      "unused",
    ),
  ).rejects.toBe(abort);
});
