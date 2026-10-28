import type { MockStore } from "./store";
import {
  canUseChannel,
  readKey,
  reconcileChannels,
} from "../features/chat/model";
import { assert } from "./store";

export function reconcileChannelParticipants(store: MockStore) {
  reconcileChannels(store.db, store.now());
}
export function allowedChatChannel(store: MockStore, id: string) {
  reconcileChannelParticipants(store);
  const channel = store.get("channels", id);
  assert(
    canUseChannel(store.activeUser(), channel),
    "참여하지 않은 대화입니다.",
    403,
    "SCOPE_DENIED",
  );
  return channel;
}
export function markChatRead(
  store: MockStore,
  channelId: string,
  parentId: string,
  sequence: number,
) {
  const channel = allowedChatChannel(store, channelId);
  if (parentId) {
    const parent = store.get("messages", parentId);
    assert(
      parent.channelId === channel.id && !parent.parentId,
      "이 대화의 스레드가 아닙니다.",
      403,
      "SCOPE_DENIED",
    );
  }
  const maximum = Math.max(
    0,
    ...store.db.messages
      .filter((m) => m.channelId === channel.id && m.parentId === parentId)
      .map((m) => m.sequence),
  );
  const key = readKey(store.user().id, parentId);
  channel.reads[key] = Math.max(
    channel.reads[key] ?? 0,
    Math.min(sequence, maximum),
  );
  return channel;
}
export function unreadMessages(store: MockStore, channelId: string) {
  const channel = allowedChatChannel(store, channelId),
    user = store.user();
  return store.db.messages.filter(
    (m) =>
      m.channelId === channel.id &&
      m.authorId !== user.id &&
      m.sequence > (channel.reads[readKey(user.id, m.parentId)] ?? 0),
  ).length;
}
