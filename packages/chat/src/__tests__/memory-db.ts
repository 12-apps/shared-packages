import type { ChatDb, ChatMessageRow, ChatReadMarkerRow, ChatThreadRow } from "../server/db";

type MessageWhere = Parameters<ChatDb["chatMessage"]["findMany"]>[0]["where"];

/** Every condition `where` names, and only those. */
function matchesMessage(row: ChatMessageRow, where: MessageWhere): boolean {
  if (row.threadId !== where.threadId) return false;
  if (where.authorRole !== undefined && row.authorRole !== where.authorRole) return false;
  if (where.authorId !== undefined && row.authorId !== where.authorId) return false;
  if (where.quickKey === null && row.quickKey !== null) return false;
  return !where.createdAt || row.createdAt.getTime() > where.createdAt.gt.getTime();
}

/** A faithful in-memory twin of the seam — it implements the interface, nothing more. */
export function memoryChatDb(): ChatDb & {
  threads: ChatThreadRow[];
  messages: ChatMessageRow[];
  markers: ChatReadMarkerRow[];
} {
  const threads: ChatThreadRow[] = [];
  const messages: ChatMessageRow[] = [];
  const markers: ChatReadMarkerRow[] = [];
  let next = 0;
  const id = (prefix: string): string => `${prefix}-${++next}`;
  return {
    threads,
    messages,
    markers,
    chatThread: {
      async findUnique({ where }) {
        const { tenantId, threadKey } = where.tenantId_threadKey;
        return threads.find((row) => row.tenantId === tenantId && row.threadKey === threadKey) ?? null;
      },
      async upsert({ where, create }) {
        const { tenantId, threadKey } = where.tenantId_threadKey;
        const found = threads.find((row) => row.tenantId === tenantId && row.threadKey === threadKey);
        if (found) return found;
        const row: ChatThreadRow = { id: id("thread"), ...create, createdAt: new Date(0), lastMessageAt: null };
        threads.push(row);
        return row;
      },
      async findMany({ where }) {
        return threads.filter((row) => row.tenantId === where.tenantId && where.threadKey.in.includes(row.threadKey));
      },
      async update({ where, data }) {
        const index = threads.findIndex((row) => row.id === where.id);
        const current = threads[index];
        if (current) threads[index] = { ...current, ...data };
        return threads[index];
      },
    },
    chatMessage: {
      async findMany({ where, take }) {
        return messages
          .filter((row) => matchesMessage(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .slice(0, take);
      },
      async create({ data }) {
        const row: ChatMessageRow = { id: id("message"), ...data };
        messages.push(row);
        return row;
      },
      async count({ where }) {
        return messages.filter(
          (row) =>
            row.threadId === where.threadId &&
            row.authorRole !== where.authorRole.not &&
            (!where.createdAt || row.createdAt.getTime() > where.createdAt.gt.getTime()),
        ).length;
      },
    },
    chatReadMarker: {
      async findUnique({ where }) {
        const { threadId, role, readerId } = where.threadId_role_readerId;
        return markers.find((row) => row.threadId === threadId && row.role === role && row.readerId === readerId) ?? null;
      },
      async findMany({ where }) {
        return markers.filter(
          (row) => where.threadId.in.includes(row.threadId) && row.role === where.role && row.readerId === where.readerId,
        );
      },
      async upsert({ where, create, update }) {
        const { threadId, role, readerId } = where.threadId_role_readerId;
        const index = markers.findIndex((row) => row.threadId === threadId && row.role === role && row.readerId === readerId);
        const current = markers[index];
        if (current) {
          markers[index] = { ...current, ...update };
          return markers[index];
        }
        const row: ChatReadMarkerRow = { id: id("marker"), ...create };
        markers.push(row);
        return row;
      },
    },
  };
}
