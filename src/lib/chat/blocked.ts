import type { ChatMessage, MessageGroupData } from "./types";

/**
 * Discord hides messages from people you blocked behind a
 * "N blocked messages — Show messages" row. Consecutive groups by blocked
 * authors collapse into one row; everything else passes through unchanged.
 */
export type ChatListItem<M extends ChatMessage> =
  | { kind: "group"; group: MessageGroupData<M>; index: number }
  | { kind: "blocked"; key: string; groups: Array<{ group: MessageGroupData<M>; index: number }>; count: number };

function authorIdOf<M extends ChatMessage>(group: MessageGroupData<M>): string {
  const first = group.messages[0];
  return String(first?.authorId || group.author?.id || "");
}

export function collapseBlockedGroups<M extends ChatMessage>(
  groups: MessageGroupData<M>[],
  blockedIds: ReadonlySet<string>,
): ChatListItem<M>[] {
  if (blockedIds.size === 0) {
    return groups.map((group, index) => ({ kind: "group", group, index }));
  }
  const items: ChatListItem<M>[] = [];
  groups.forEach((group, index) => {
    const first = group.messages[0];
    // Webhook posts and system rows aren't "from" the blocked account.
    const blocked = !!first && !first.webhookId && blockedIds.has(authorIdOf(group));
    if (!blocked) {
      items.push({ kind: "group", group, index });
      return;
    }
    const last = items[items.length - 1];
    if (last && last.kind === "blocked") {
      last.groups.push({ group, index });
      last.count += group.messages.length;
    } else {
      items.push({ kind: "blocked", key: `blocked-${String(first.id)}`, groups: [{ group, index }], count: group.messages.length });
    }
  });
  return items;
}

/** Whether an incoming message author is blocked (for notification suppression). */
export function isBlockedAuthor(authorId: string | null | undefined, blockedIds: ReadonlySet<string>): boolean {
  return Boolean(authorId) && blockedIds.has(String(authorId));
}
