import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "../../shared/domain/schema";
import { useChatFeed } from "./hooks";
import { chatApi } from "./api";
import type { CanonicalMessage } from "./canonical";
vi.mock("../../app/context", () => ({
  useApp: () => ({ session: { user: { id: "viewer" } }, scope: "1" }),
}));
vi.mock("./api", () => ({ chatApi: { messages: vi.fn(), parent: vi.fn() } }));
const clients: QueryClient[] = [];

it.each([0, 2])(
  "refreshes an old loaded root's thread state even if it previously had %i replies",
  async (replyCount) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const root = {
      id: "1",
      canonicalId: "1",
      sequence: 0,
      channelId: "5",
      parentId: "",
      replyCount,
      threadUnreadCount: replyCount,
      threadLastReadMessageId: null,
    } as CanonicalMessage;
    const latest = { id: "99", sequence: 0 } as Message;
    const key = [
      "data",
      "viewer",
      "1",
      "chat",
      "channel",
      "5",
      "feed",
      "main",
      "",
    ];
    client.setQueryData(key, { items: [root, latest] });
    vi.mocked(chatApi.messages).mockResolvedValue({ items: [latest] });
    const readRoot: CanonicalMessage = {
      ...root,
      replyCount: 3,
      threadUnreadCount: 1,
      threadLastReadMessageId: "88",
    };
    vi.mocked(chatApi.parent).mockResolvedValue(readRoot);
    const view = renderHook(() => useChatFeed("5", "", true), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(view.result.current.isFetching).toBe(false));
    expect(chatApi.parent).toHaveBeenCalledWith(
      "1",
      "1",
      expect.any(AbortSignal),
      "5",
    );
    expect(view.result.current.messages[0]).toMatchObject({
      replyCount: 3,
      threadUnreadCount: 1,
      threadLastReadMessageId: "88",
    });
  },
);
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
});
it("refreshes old loaded canonical cards through the message endpoint when they are outside the latest page", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const card = {
    id: "9007199254740993",
    canonicalId: "9007199254740993",
    sequence: 0,
    channelId: "5",
    parentId: "",
    taskCard: { accessible: true, title: "old" },
  } as CanonicalMessage;
  const latest = { id: "9007199254741100", sequence: 0 } as Message;
  const key = [
    "data",
    "viewer",
    "1",
    "chat",
    "channel",
    "5",
    "feed",
    "main",
    "",
  ];
  client.setQueryData(key, { items: [card, latest] });
  vi.mocked(chatApi.messages).mockResolvedValue({ items: [latest] });
  const hidden = {
    ...card,
    taskId: "",
    taskCard: {
      accessible: false,
      taskId: null,
      branchId: null,
      title: null,
      status: null,
      priority: null,
      assignee: null,
      dueAt: null,
    },
  };
  vi.mocked(chatApi.parent).mockResolvedValue(hidden);
  const view = renderHook(() => useChatFeed("5", "", true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(view.result.current.isFetching).toBe(false));
  expect(chatApi.parent).toHaveBeenCalledWith(
    card.id,
    "1",
    expect.any(AbortSignal),
    "5",
  );
  expect(view.result.current.messages[0]).toEqual(hidden);
});
