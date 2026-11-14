import { DELIVERY_RANK, RECEIPT_COLUMN, type MessagingStore, type StoredConnection } from "./store";
import type {
  ConnectionView,
  ConversationView,
  DeliveryStatus,
  InboxDeliveryView,
  MessageView,
  ReceiptStatus,
} from "./types";

/**
 * The Prisma delegates the store reads and writes.
 *
 * Structural rather than a `PrismaClient` import: the package must not depend
 * on the host's generated client, and this shape is what any client generated
 * from the shipped partial satisfies. Only the query subset below is used —
 * equality, `in`, `lt`, `lte`, `not: null`, compound unique keys, `increment`,
 * `orderBy`, `take` — which is also what the package's Postgres suite
 * translates, so the suite runs the exact queries a host runs.
 */
export interface MessagingPrismaDb {
  messagingConnection: Delegate;
  messagingInboxDelivery: Delegate;
  messagingConversation: Delegate;
  messagingMessage: Delegate;
}

interface Delegate {
  findUnique(args: unknown): Promise<unknown>;
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

/** Prisma's unique-violation code. */
const UNIQUE_VIOLATION = "P2002";
const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;

const CONNECTION_VIEW = {
  id: true,
  tenantId: true,
  channel: true,
  externalAccountId: true,
  externalParentId: true,
  displayAddress: true,
  status: true,
  statusReason: true,
  connectedAt: true,
  revokedAt: true,
} as const;

const DELIVERY_VIEW = {
  id: true,
  channel: true,
  rawBody: true,
  state: true,
  attempts: true,
  error: true,
  receivedAt: true,
  processedAt: true,
} as const;

const pickConversation = (row: ConversationView): ConversationView => ({
  id: row.id,
  tenantId: row.tenantId,
  channel: row.channel,
  contactId: row.contactId,
  contactName: row.contactName,
  connectionId: row.connectionId,
  state: row.state,
  lastInboundAt: row.lastInboundAt,
  lastMessageAt: row.lastMessageAt,
  hasText: row.hasText,
  summary: row.summary,
  summaryUpdatedAt: row.summaryUpdatedAt,
  createdAt: row.createdAt,
});

type Client = () => Promise<MessagingPrismaDb>;

/** A {@link MessagingStore} over a Prisma client generated from the shipped partial. */
export function createPrismaMessagingStore(db: MessagingPrismaDb | (() => Promise<MessagingPrismaDb>)): MessagingStore {
  const client: Client = typeof db === "function" ? db : async () => db;
  return {
    ...inboxOperations(client),
    ...connectionOperations(client),
    ...conversationOperations(client),
    ...messageOperations(client),
    purgeExpiredText: (input) => purgeExpiredText(client, input),
  };
}

type InboxOperations = Pick<
  MessagingStore,
  "recordDelivery" | "getDelivery" | "settleDelivery" | "listRetryableDeliveries"
>;

function inboxOperations(client: Client): InboxOperations {
  return {
    async recordDelivery({ channel, bodyHash, rawBody, receivedAt }) {
      const delegate = (await client()).messagingInboxDelivery;
      const key = { channel_bodyHash: { channel, bodyHash } };
      const existing = (await delegate.findUnique({ where: key, select: { id: true } })) as { id: string } | null;
      if (existing) return { id: existing.id, fresh: false };
      try {
        const row = (await delegate.create({
          data: { channel, bodyHash, rawBody, receivedAt },
          select: { id: true },
        })) as { id: string };
        return { id: row.id, fresh: true };
      } catch (error) {
        // Two simultaneous redeliveries lose the check-then-insert race; the
        // unique index is the real guard, and losing it is a redelivery.
        if (!isUniqueViolation(error)) throw error;
        const raced = (await delegate.findUnique({ where: key, select: { id: true } })) as { id: string };
        return { id: raced.id, fresh: false };
      }
    },
    async getDelivery(id) {
      return ((await (await client()).messagingInboxDelivery.findUnique({
        where: { id },
        select: DELIVERY_VIEW,
      })) as InboxDeliveryView | null) ?? null;
    },
    async settleDelivery(id, { state, error, at }) {
      await (await client()).messagingInboxDelivery.updateMany({
        where: { id },
        data: { state, error, processedAt: at, attempts: { increment: 1 } },
      });
    },
    async listRetryableDeliveries({ receivedBefore, maxAttempts, take }) {
      return (await (await client()).messagingInboxDelivery.findMany({
        where: { state: { in: ["PENDING", "FAILED"] }, attempts: { lt: maxAttempts }, receivedAt: { lt: receivedBefore } },
        orderBy: { receivedAt: "asc" },
        take,
        select: DELIVERY_VIEW,
      })) as InboxDeliveryView[];
    },
  };
}

type ConnectionOperations = Pick<
  MessagingStore,
  "findConnectionByAccount" | "getConnection" | "listConnections" | "saveConnection" | "setConnectionStatus"
>;

function connectionOperations(client: Client): ConnectionOperations {
  const findConnectionByAccount = async (channel: string, externalAccountId: string) =>
    ((await (await client()).messagingConnection.findUnique({
      where: { channel_externalAccountId: { channel, externalAccountId } },
    })) as StoredConnection | null) ?? null;
  return {
    findConnectionByAccount,
    async getConnection(tenantId, id) {
      return ((await (await client()).messagingConnection.findFirst({ where: { id, tenantId } })) as StoredConnection | null) ?? null;
    },
    async listConnections(tenantId) {
      return (await (await client()).messagingConnection.findMany({
        where: { tenantId },
        orderBy: { connectedAt: "asc" },
        select: CONNECTION_VIEW,
      })) as ConnectionView[];
    },
    async saveConnection(input) {
      const delegate = (await client()).messagingConnection;
      const data = { ...input, status: "CONNECTED", statusReason: null, revokedAt: null };
      const existing = await findConnectionByAccount(input.channel, input.externalAccountId);
      const row = existing
        ? await delegate.update({ where: { id: existing.id }, data, select: CONNECTION_VIEW })
        : await delegate.create({ data, select: CONNECTION_VIEW });
      return row as ConnectionView;
    },
    async setConnectionStatus(tenantId, id, patch) {
      const result = await (await client()).messagingConnection.updateMany({ where: { id, tenantId }, data: patch });
      return result.count > 0;
    },
  };
}

type ConversationOperations = Pick<
  MessagingStore,
  "findConversation" | "getConversation" | "createConversation" | "updateConversation"
>;

function conversationOperations(client: Client): ConversationOperations {
  const findConversation = async (tenantId: string, channel: string, contactId: string) => {
    const row = (await (await client()).messagingConversation.findUnique({
      where: { tenantId_channel_contactId: { tenantId, channel, contactId } },
    })) as ConversationView | null;
    return row ? pickConversation(row) : null;
  };
  return {
    findConversation,
    async getConversation(tenantId, id) {
      const row = (await (await client()).messagingConversation.findFirst({ where: { id, tenantId } })) as ConversationView | null;
      return row ? pickConversation(row) : null;
    },
    async createConversation(input) {
      try {
        return pickConversation((await (await client()).messagingConversation.create({ data: input })) as ConversationView);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await findConversation(input.tenantId, input.channel, input.contactId);
        if (!raced) throw error;
        return raced;
      }
    },
    async updateConversation(tenantId, id, patch) {
      const delegate = (await client()).messagingConversation;
      const result = await delegate.updateMany({ where: { id, tenantId }, data: patch });
      if (result.count === 0) return null;
      return pickConversation((await delegate.findUnique({ where: { id } })) as ConversationView);
    },
  };
}

type MessageOperations = Pick<
  MessagingStore,
  "findMessageByExternalId" | "insertMessage" | "updateMessage" | "listMessages" | "applyReceipt"
>;

function messageOperations(client: Client): MessageOperations {
  const findMessageByExternalId = async (channel: string, externalId: string) =>
    ((await (await client()).messagingMessage.findUnique({
      where: { channel_externalId: { channel, externalId } },
    })) as MessageView | null) ?? null;
  return {
    findMessageByExternalId,
    async insertMessage(input) {
      try {
        return { created: true, message: (await (await client()).messagingMessage.create({ data: input })) as MessageView };
      } catch (error) {
        if (!isUniqueViolation(error) || input.externalId === null) throw error;
        const existing = await findMessageByExternalId(input.channel, input.externalId);
        if (!existing) throw error;
        return { created: false, message: existing };
      }
    },
    async updateMessage(tenantId, id, patch) {
      const delegate = (await client()).messagingMessage;
      const result = await delegate.updateMany({ where: { id, tenantId }, data: patch });
      if (result.count === 0) return null;
      return (await delegate.findUnique({ where: { id } })) as MessageView;
    },
    async listMessages(tenantId, conversationId) {
      return (await (await client()).messagingMessage.findMany({
        where: { tenantId, conversationId },
        orderBy: { createdAt: "asc" },
      })) as MessageView[];
    },
    applyReceipt: (input) => applyReceipt(client, input),
  };
}

async function applyReceipt(client: Client, input: Parameters<MessagingStore["applyReceipt"]>[0]): Promise<boolean> {
  const { tenantId, channel, externalId, status, at, error } = input;
  const delegate = (await client()).messagingMessage;
  const scope = { tenantId, channel, externalId, direction: "OUTBOUND" };
  const found = (await delegate.findFirst({ where: scope, select: { id: true } })) as { id: string } | null;
  if (!found) return false;
  const column = RECEIPT_COLUMN[status];
  // The timestamp column is written once: a second identical receipt matches
  // nothing. Then the status moves only forward, in a second guarded write,
  // so a late SENT never overwrites a READ.
  await delegate.updateMany({
    where: { id: found.id, [column]: null },
    data: { [column]: at, ...(error !== null ? { error } : {}) },
  });
  await delegate.updateMany({
    where: { id: found.id, deliveryStatus: { in: statusesBelow(status) } },
    data: { deliveryStatus: status },
  });
  return true;
}

async function purgeExpiredText(
  client: Client,
  { cutoff, take }: { cutoff: Date; take: number },
): Promise<{ conversations: number; messages: number }> {
  const db = await client();
  const due = (await db.messagingConversation.findMany({
    where: { hasText: true, lastMessageAt: { lt: cutoff } },
    orderBy: { lastMessageAt: "asc" },
    take,
    select: { id: true },
  })) as { id: string }[];
  if (due.length === 0) return { conversations: 0, messages: 0 };
  const ids = due.map((row) => row.id);
  const purged = await db.messagingMessage.updateMany({
    where: { conversationId: { in: ids }, createdAt: { lte: cutoff } },
    data: { body: null, options: null, transcript: null },
  });
  // Guarded on the same predicate: a conversation that took a message since
  // the read above keeps its flag, and its new text.
  await db.messagingConversation.updateMany({
    where: { id: { in: ids }, lastMessageAt: { lt: cutoff } },
    data: { hasText: false },
  });
  return { conversations: due.length, messages: purged.count };
}

/** Every status a receipt may move a message forward from. */
function statusesBelow(status: ReceiptStatus): DeliveryStatus[] {
  return (Object.keys(DELIVERY_RANK) as DeliveryStatus[]).filter((candidate) => DELIVERY_RANK[candidate] < DELIVERY_RANK[status]);
}
