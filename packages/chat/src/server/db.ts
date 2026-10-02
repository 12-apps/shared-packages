/**
 * The database seam: exactly the delegate calls this package makes, shaped so
 * a generated Prisma client carrying the `prisma/chat.prisma` models satisfies
 * it structurally — and so a test fake implementing the interface behaves the
 * same. Nothing here may rely on a client-specific error code.
 */

export interface ChatThreadRow {
  readonly id: string;
  readonly tenantId: string;
  readonly threadKey: string;
  readonly createdAt: Date;
  readonly lastMessageAt: Date | null;
}

export interface ChatMessageRow {
  readonly id: string;
  readonly threadId: string;
  readonly tenantId: string;
  readonly authorRole: string;
  readonly authorId: string;
  readonly body: string;
  readonly quickKey: string | null;
  readonly createdAt: Date;
}

export interface ChatReadMarkerRow {
  readonly id: string;
  readonly threadId: string;
  readonly role: string;
  readonly readerId: string;
  readonly lastReadAt: Date;
}

type ThreadKeyWhere = { tenantId_threadKey: { tenantId: string; threadKey: string } };
type MarkerKeyWhere = { threadId_role_readerId: { threadId: string; role: string; readerId: string } };

export interface ChatDb {
  chatThread: {
    findUnique(args: { where: ThreadKeyWhere }): Promise<ChatThreadRow | null>;
    upsert(args: {
      where: ThreadKeyWhere;
      create: { tenantId: string; threadKey: string };
      update: Record<string, never>;
    }): Promise<ChatThreadRow>;
    findMany(args: { where: { tenantId: string; threadKey: { in: string[] } } }): Promise<ChatThreadRow[]>;
    update(args: { where: { id: string }; data: { lastMessageAt: Date } }): Promise<unknown>;
  };
  chatMessage: {
    findMany(args: {
      where: { threadId: string };
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<ChatMessageRow[]>;
    create(args: {
      data: {
        threadId: string;
        tenantId: string;
        authorRole: string;
        authorId: string;
        body: string;
        quickKey: string | null;
        createdAt: Date;
      };
    }): Promise<ChatMessageRow>;
    count(args: {
      where: { threadId: string; authorRole: { not: string }; createdAt?: { gt: Date } };
    }): Promise<number>;
  };
  chatReadMarker: {
    findUnique(args: { where: MarkerKeyWhere }): Promise<ChatReadMarkerRow | null>;
    findMany(args: {
      where: { threadId: { in: string[] }; role: string; readerId: string };
    }): Promise<ChatReadMarkerRow[]>;
    upsert(args: {
      where: MarkerKeyWhere;
      create: { threadId: string; role: string; readerId: string; lastReadAt: Date };
      update: { lastReadAt: Date };
    }): Promise<ChatReadMarkerRow>;
  };
}
