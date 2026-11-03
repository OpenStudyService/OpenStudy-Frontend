import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageViewport } from "./MessageViewport";
import type { ChatFeed } from "./hooks";
import { chatApi } from "./api";
import { MockStore } from "../../mocks/store";
const mode = vi.hoisted(() => ({ mock: true }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  get MOCK() {
    return mode.mock;
  },
}));

vi.mock("../../app/context", () => ({
  useApp: () => ({ session: { user: { id: "junho" } }, scope: "gangnam" }),
}));
vi.mock("./api", () => ({ chatApi: { read: vi.fn() } }));
const clients: QueryClient[] = [];
let height = 200,
  visibleHeight = 200;
beforeEach(() => {
  vi.resetAllMocks();
  mode.mock = true;
  height = 200;
  visibleHeight = 200;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => visibleHeight,
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => height,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: 0,
        bottom: this.classList.contains("messages") ? visibleHeight : 100,
        left: 0,
        right: 200,
        height: 100,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.mocked(chatApi.read).mockResolvedValue({ ok: true });
});
it("uses the exact bigint root ID in live mode", async () => {
  mode.mock = false;
  const feed = fixture();
  const message = {
    ...feed.messages[0],
    id: "9007199254740993",
    canonicalId: "9007199254740993",
  };
  mount({ ...feed, messages: [message] });
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
  expect(vi.mocked(chatApi.read).mock.calls[0].slice(0, 3)).toEqual([
    "gangnam",
    "",
    "9007199254740993",
  ]);
});

afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function fixture(over: Partial<ChatFeed> = {}): ChatFeed {
  const message = { ...new MockStore(false).db.messages[0], sequence: 5 };
  return {
    messages: [message],
    isPending: false,
    error: null,
    olderError: null,
    isFetching: false,
    isFetchingNextPage: false,
    dataUpdatedAt: 1,
    hasNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ChatFeed;
}
function mount(feed: ChatFeed, parentId = "") {
  const client = new QueryClient();
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MessageViewport
        feed={feed}
        channelId="gangnam"
        parentId={parentId}
        onDenied={vi.fn()}
      >
        <article>표시된 메시지</article>
      </MessageViewport>
    </QueryClientProvider>,
  );
}
it("acknowledges the visible root timeline using its own last sequence", async () => {
  mount(fixture());
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
  expect(vi.mocked(chatApi.read).mock.calls[0].slice(0, 3)).toEqual([
    "gangnam",
    "",
    5,
  ]);
});
it("does not acknowledge a hidden tab or a hidden conversation pane", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  mount(fixture());
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(chatApi.read).not.toHaveBeenCalled();
  cleanup();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  visibleHeight = 0;
  mount(fixture());
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(chatApi.read).not.toHaveBeenCalled();
});
it("addresses an opened thread separately and retries a failed receipt explicitly", async () => {
  vi.mocked(chatApi.read).mockRejectedValueOnce(new Error("실패"));
  mount(fixture(), "root-1");
  await screen.findByText("읽음 상태를 저장하지 못했어요.");
  expect(chatApi.read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "읽음 다시 시도" }));
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(2));
  expect(vi.mocked(chatApi.read).mock.calls[1].slice(0, 3)).toEqual([
    "gangnam",
    "root-1",
    5,
  ]);
});
it("preserves the viewport anchor when older messages are prepended", async () => {
  height = 1000;
  const feed = fixture({ hasNextPage: true });
  const view = mount(feed);
  const pane = view.container.querySelector(".messages") as HTMLDivElement;
  pane.scrollTop = 300;
  fireEvent.scroll(pane);
  fireEvent.click(screen.getByRole("button", { name: "이전 메시지 불러오기" }));
  height = 1200;
  const client = clients[0];
  view.rerender(
    <QueryClientProvider client={client}>
      <MessageViewport
        feed={{ ...feed, dataUpdatedAt: 2 }}
        channelId="gangnam"
        parentId=""
        onDenied={vi.fn()}
      >
        <article>추가된 과거 기록</article>
      </MessageViewport>
    </QueryClientProvider>,
  );
  expect(pane.scrollTop).toBe(500);
});
it("does not read content hidden behind an accessible modal", async () => {
  const view = mount(fixture());
  view.container.setAttribute("aria-hidden", "true");
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(chatApi.read).not.toHaveBeenCalled();
  view.container.removeAttribute("aria-hidden");
  fireEvent.focusIn(view.container.querySelector(".messages")!);
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
});
it("cancels an in-flight read when a newer snapshot arrives and does not let the old completion block the new receipt", async () => {
  const complete: (() => void)[] = [];
  vi.mocked(chatApi.read).mockImplementation(
    () => new Promise((resolve) => complete.push(() => resolve({ ok: true }))),
  );
  const feed = fixture(),
    view = mount(feed);
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
  const oldSignal = vi.mocked(chatApi.read).mock.calls[0][3];
  const invalidated = vi.spyOn(clients[0], "invalidateQueries");
  view.rerender(
    <QueryClientProvider client={clients[0]}>
      <MessageViewport
        feed={{
          ...feed,
          messages: [{ ...feed.messages[0], sequence: 6 }],
          dataUpdatedAt: 2,
        }}
        channelId="gangnam"
        parentId=""
        onDenied={vi.fn()}
      >
        <article>새 하단</article>
      </MessageViewport>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => complete[0]());
  expect(invalidated).not.toHaveBeenCalled();
  await act(async () => complete[1]());
  expect(invalidated).toHaveBeenCalledTimes(1);
});
it("uses the exact reply ID for live threads and clears private content on a 404 participation loss", async () => {
  mode.mock = false;
  const denied = vi.fn();
  const feed = fixture(),
    message = {
      ...feed.messages[0],
      id: "9007199254740997",
      canonicalId: "9007199254740997",
    };
  const { ApiError } = await import("../../shared/api/client");
  vi.mocked(chatApi.read).mockRejectedValue(
    new ApiError(404, { code: "NOT_FOUND", message: "참여 종료" }),
  );
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MessageViewport
        feed={{ ...feed, messages: [message] }}
        channelId="10"
        parentId="9007199254740993"
        onDenied={denied}
      >
        <article>답글</article>
      </MessageViewport>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(vi.mocked(chatApi.read).mock.calls[0].slice(0, 3)).toEqual([
    "10",
    "9007199254740993",
    "9007199254740997",
  ]);
});
it("does not acknowledge newly loaded messages below a scrolled-up viewport", async () => {
  const feed = fixture(),
    view = mount(feed);
  await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
  const pane = view.container.querySelector(".messages") as HTMLDivElement;
  height = 1000;
  pane.scrollTop = 10;
  fireEvent.scroll(pane);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: 0,
        bottom: this.classList.contains("messages") ? 200 : 900,
        left: 0,
        right: 200,
        height: 200,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );
  const updated = {
    ...feed,
    dataUpdatedAt: 2,
    messages: [{ ...feed.messages[0], sequence: 6 }],
  };
  view.rerender(
    <QueryClientProvider client={clients[0]}>
      <MessageViewport
        feed={updated}
        channelId="gangnam"
        parentId=""
        onDenied={vi.fn()}
      >
        <article>아래쪽 새 메시지</article>
      </MessageViewport>
    </QueryClientProvider>,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(chatApi.read).toHaveBeenCalledTimes(1);
});
