import { expect, it } from "vitest";
import { MockStore } from "../../mocks/store";
import { create, sendMessage, update, rowsFor } from "../../mocks/domain";
import {
  allowedChatChannel,
  markChatRead,
  unreadMessages,
} from "../../mocks/chat-policy";
import { canManageChannel, mergeMessages, refreshFeed } from "./model";
import type { Message, ResourceMap } from "../../shared/domain/schema";

function fixture() {
  const store = new MockStore(false);
  store.persona = "owner";
  return store;
}
const channelInput = {
  branchId: "gangnam",
  name: "교대",
  description: "",
  participantIds: ["junho"],
};
it("separates management authorization from membership and does not add the manager back", () => {
  const store = fixture(),
    channel = create(
      store,
      "channels",
      channelInput,
    ) as ResourceMap["channels"];
  expect(channel.participantIds).toEqual(["junho"]);
  expect(canManageChannel(store.user(), channel.branchId)).toBe(true);
  expect(
    rowsFor(store, "channels", "gangnam").some((c) => c.id === channel.id),
  ).toBe(false);
  expect(() => allowedChatChannel(store, channel.id)).toThrow(/참여하지/);
  update(store, "channels", channel.id, {
    version: 1,
    name: "새 이름",
    participantIds: ["junho"],
  });
  expect(store.get("channels", channel.id).participantIds).toEqual(["junho"]);
});
it("allows only owner to manage global channels and only the matching branch manager otherwise", () => {
  const store = fixture();
  const global = create(store, "channels", {
    ...channelInput,
    branchId: "all",
    participantIds: ["junho", "doyun"],
  });
  expect(global.branchId).toBe("all");
  store.persona = "minji";
  expect(() =>
    create(store, "channels", { ...channelInput, branchId: "all" }),
  ).toThrow(/관리/);
  expect(() =>
    create(store, "channels", { ...channelInput, branchId: "seongsu" }),
  ).toThrow(/권한/);
  expect(() =>
    create(store, "channels", { ...channelInput, participantIds: ["doyun"] }),
  ).toThrow(/활성 직원/);
  store.get("employees", "junho").memberships[0].status = "회수";
  expect(() => create(store, "channels", channelInput)).toThrow(/활성 직원/);
});
it("ends branch membership on revocation and does not restore participation on reinstatement", () => {
  const store = fixture(),
    person = store.get("employees", "junho"),
    memberships = structuredClone(person.memberships);
  person.memberships[0].status = "회수";
  store.emit("employees", person.id, "all", "permissions");
  expect(store.get("channels", "gangnam").participantIds).not.toContain(
    person.id,
  );
  person.memberships = memberships;
  store.persona = person.id;
  expect(() => allowedChatChannel(store, "gangnam")).toThrow(/참여하지/);
  expect(() =>
    sendMessage(store, {
      channelId: "gangnam",
      parentId: "",
      taskId: "",
      text: "거부",
      clientMessageId: "revoked",
    }),
  ).toThrow(/참여하지/);
});
it("keeps unopened replies unread after the root timeline is read", () => {
  const store = fixture();
  store.db.messages = [];
  const message = (text: string, parentId = "") =>
    sendMessage(store, {
      channelId: "gangnam",
      text,
      parentId,
      taskId: "",
      clientMessageId: text,
    });
  const root = message("원문"),
    reply = message("답글", root.id),
    other = message("다른 원문"),
    anotherReply = message("다른 답글", other.id);
  store.persona = "junho";
  markChatRead(store, "gangnam", "", anotherReply.sequence);
  expect(unreadMessages(store, "gangnam")).toBe(2);
  markChatRead(store, "gangnam", root.id, reply.sequence);
  expect(unreadMessages(store, "gangnam")).toBe(1);
  markChatRead(store, "gangnam", other.id, anotherReply.sequence);
  expect(unreadMessages(store, "gangnam")).toBe(0);
  markChatRead(store, "gangnam", root.id, 0);
  expect(unreadMessages(store, "gangnam")).toBe(0);
  expect(() => markChatRead(store, "seongsu", root.id, reply.sequence)).toThrow(
    /참여하지/,
  );
});
it("rejects reusing a message key with a different task or thread", () => {
  const store = fixture(),
    body = {
      channelId: "gangnam",
      parentId: "",
      taskId: "task-1",
      text: "공유",
      clientMessageId: "same",
    };
  expect(sendMessage(store, body).id).toBe(sendMessage(store, body).id);
  expect(() => sendMessage(store, { ...body, taskId: "task-2" })).toThrow(
    /식별자/,
  );
});
it("fills a multi-page refresh gap without losing earlier history or duplicating messages", async () => {
  const store = fixture(),
    template = store.db.messages[0];
  const messages = Array.from({ length: 100 }, (_, i): Message => ({
    ...template,
    id: `m-${i + 1}`,
    sequence: i + 1,
    parentId: "",
  }));
  const fetched: string[] = [];
  const result = await refreshFeed(
    { items: messages.slice(0, 10) },
    async (cursor) => {
      fetched.push(cursor ?? "latest");
      const remaining = messages.filter(
        (m) => m.sequence < Number(cursor ?? Infinity),
      );
      const items = remaining.slice(-30);
      return {
        items,
        nextCursor:
          remaining.length > 30 ? String(items[0].sequence) : undefined,
      };
    },
  );
  expect(result.items.map((m) => m.sequence)).toEqual(
    messages.map((m) => m.sequence),
  );
  expect(fetched).toHaveLength(4);
  expect(
    mergeMessages(messages.slice(0, 4), messages.slice(2, 6)),
  ).toHaveLength(6);
});
it("rejects a looping cursor instead of falsely completing a gap", async () => {
  const template = fixture().db.messages[0];
  await expect(
    refreshFeed({ items: [{ ...template, sequence: 1 }] }, async () => ({
      items: [{ ...template, id: "fresh", sequence: 50 }],
      nextCursor: "repeat",
    })),
  ).rejects.toThrow(/커서/);
});
