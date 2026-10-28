import { admin, can } from "../../shared/domain/schema";
import type {
  Database,
  Employee,
  Message,
  ResourceMap,
} from "../../shared/domain/schema";

export type Channel = ResourceMap["channels"] & { unread: number };
export interface MessageFeed {
  items: Message[];
  nextCursor?: string;
}
export const canManageChannel = (user: Employee, branch: string) =>
  user.status === "활성" &&
  (branch === "all" ? user.owner : admin(user, branch));
export const canJoinChannel = (user: Employee, branch: string) =>
  can(user, branch);
export const canUseChannel = (
  user: Employee,
  channel: ResourceMap["channels"],
) =>
  channel.participantIds.includes(user.id) &&
  canJoinChannel(user, channel.kind === "dm" ? "all" : channel.branchId);
export function reconcileChannels(db: Database, now: string) {
  for (const channel of db.channels) {
    if (channel.kind !== "channel") continue;
    const eligible = channel.participantIds.filter((id) => {
      const person = db.employees.find((p) => p.id === id);
      return person && canJoinChannel(person, channel.branchId);
    });
    if (eligible.length !== channel.participantIds.length) {
      channel.participantIds = eligible;
      channel.version++;
      channel.updatedAt = now;
    }
  }
}
export const readKey = (userId: string, parentId = "") =>
  parentId ? JSON.stringify([userId, parentId]) : userId;
export const draftKey = (
  userId: string,
  scope: string,
  channelId: string,
  parentId = "",
) => JSON.stringify([userId, scope, channelId, parentId]);
export function mergeMessages(...pages: Message[][]) {
  return [
    ...new Map(pages.flat().map((message) => [message.id, message])).values(),
  ].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export async function refreshFeed(
  previous: MessageFeed | undefined,
  fetchPage: (cursor?: string) => Promise<MessageFeed>,
): Promise<MessageFeed> {
  const first = await fetchPage(),
    fresh = [...first.items];
  const highest = previous?.items.at(-1)?.sequence ?? 0;
  let page = first;
  const cursors = new Set<string>();
  // Fill the gap when more than one page arrived between refreshes.
  while (
    highest &&
    page.nextCursor &&
    page.items.length &&
    page.items[0].sequence > highest
  ) {
    if (cursors.has(page.nextCursor))
      throw new Error("메시지 커서가 반복됩니다. 다시 조회해 주세요.");
    cursors.add(page.nextCursor);
    page = await fetchPage(page.nextCursor);
    fresh.push(...page.items);
  }
  return {
    items: mergeMessages(previous?.items ?? [], fresh),
    nextCursor: previous?.items.length ? previous.nextCursor : first.nextCursor,
  };
}
