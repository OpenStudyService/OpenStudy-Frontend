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
      channel.formerParticipantIds = [
        ...new Set([
          ...(channel.formerParticipantIds ?? []),
          ...channel.participantIds.filter((id) => !eligible.includes(id)),
        ]),
      ];
      channel.participantIds = eligible;
      channel.version++;
      channel.updatedAt = now;
    }
  }
}
/** M7-D09: only a returning member starts at the latest channel position. */
export function participationReads(
  channel: ResourceMap["channels"],
  ids: string[],
  messages: Message[],
) {
  const former = new Set([
    ...(channel.formerParticipantIds ?? []),
    ...channel.participantIds.filter((id) => !ids.includes(id)),
  ]);
  const reads = { ...channel.reads };
  const rows = messages.filter((m) => m.channelId === channel.id);
  const latest = Math.max(0, ...rows.map((m) => m.sequence));
  for (const userId of ids) {
    if (
      !channel.participantIds.includes(userId) &&
      former.has(userId) &&
      latest
    ) {
      for (const parentId of [
        "",
        ...rows.filter((m) => !m.parentId).map((m) => m.id),
      ]) {
        const key = readKey(userId, parentId);
        reads[key] = Math.max(reads[key] ?? 0, latest);
      }
    }
  }
  return { formerParticipantIds: [...former], reads };
}
export const readKey = (userId: string, parentId = "") =>
  parentId ? JSON.stringify([userId, parentId]) : userId;
export const draftKey = (
  userId: string,
  scope: string,
  channelId: string,
  parentId = "",
) => JSON.stringify([userId, scope, channelId, parentId]);
export function compareMessages(a: Message, b: Message) {
  // Canonical IDs are unsigned bigint strings. Conversion to Number loses
  // ordering beyond 2^53; legacy demo messages still use numeric sequences.
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
    const left = BigInt(a.id),
      right = BigInt(b.id);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return a.sequence - b.sequence || a.id.localeCompare(b.id);
}
export function mergeMessages(...pages: Message[][]) {
  return [
    ...new Map(pages.flat().map((message) => [message.id, message])).values(),
  ].sort(compareMessages);
}
export async function refreshFeed(
  previous: MessageFeed | undefined,
  fetchPage: (cursor?: string) => Promise<MessageFeed>,
): Promise<MessageFeed> {
  const first = await fetchPage(),
    fresh = [...first.items];
  const highest = previous?.items.at(-1);
  let page = first;
  const cursors = new Set<string>();
  // Fill the gap when more than one page arrived between refreshes.
  while (
    highest &&
    page.nextCursor &&
    page.items.length &&
    compareMessages(page.items[0], highest) > 0
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
