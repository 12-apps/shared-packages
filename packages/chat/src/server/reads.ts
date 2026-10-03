/**
 * Reads a host embeds in its OWN lists — the unread badge on every row of a
 * board, say — without a request per row. Plain functions over the db seam,
 * not routes: the list belongs to the host, the counts to this package.
 */

import type { ChatDb } from "./db";

export interface UnreadCountsQuery {
  readonly tenantId: string;
  readonly threadKeys: readonly string[];
  /** The reader's role: messages by THIS role never count as unread for it. */
  readonly role: string;
  readonly readerId: string;
}

export interface ChatReads {
  /** Messages by other roles since the reader's marker, per thread key. Keys with no thread answer 0. */
  unreadCounts(query: UnreadCountsQuery): Promise<Record<string, number>>;
}

export function createChatReads(config: { db: () => Promise<ChatDb> }): ChatReads {
  return {
    async unreadCounts(query) {
      const counts: Record<string, number> = Object.fromEntries(query.threadKeys.map((key) => [key, 0]));
      if (query.threadKeys.length === 0) return counts;
      const db = await config.db();
      const threads = await db.chatThread.findMany({
        where: { tenantId: query.tenantId, threadKey: { in: [...query.threadKeys] } },
      });
      const live = threads.filter((thread) => thread.lastMessageAt !== null);
      if (live.length === 0) return counts;
      const markers = await db.chatReadMarker.findMany({
        where: { threadId: { in: live.map((thread) => thread.id) }, role: query.role, readerId: query.readerId },
      });
      const readAt = new Map(markers.map((marker) => [marker.threadId, marker.lastReadAt]));
      await Promise.all(
        live.map(async (thread) => {
          const since = readAt.get(thread.id);
          counts[thread.threadKey] = await db.chatMessage.count({
            where: {
              threadId: thread.id,
              authorRole: { not: query.role },
              ...(since ? { createdAt: { gt: since } } : {}),
            },
          });
        }),
      );
      return counts;
    },
  };
}
