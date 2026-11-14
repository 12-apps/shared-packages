import { randomUUID } from "node:crypto";

import { DELIVERY_RANK, RECEIPT_COLUMN, type MessagingStore, type StoredConnection } from "./store";
import type { ConnectionView, ConversationView, InboxDeliveryView, MessageView } from "./types";

/**
 * An in-memory {@link MessagingStore}, for a host's tests and this package's
 * own. It enforces the migration's unique keys the way Postgres does, so a
 * test that passes here exercises the same dedupe a database would.
 *
 * Not for production: it lives in one process and forgets on restart.
 */
export function createMemoryMessagingStore(): MessagingStore & { readonly dump: () => MemoryStoreDump } {
  const tables: MemoryTables = {
    deliveries: new Map(),
    connections: new Map(),
    conversations: new Map(),
    messages: new Map(),
  };
  return {
    ...memoryInbox(tables),
    ...memoryConnections(tables),
    ...memoryConversations(tables),
    ...memoryMessages(tables),
    purgeExpiredText: async (input) => purge(tables, input),
    dump: () => ({
      deliveries: [...tables.deliveries.values()].map(copy),
      connections: [...tables.connections.values()].map(copy),
      conversations: [...tables.conversations.values()].map(copy),
      messages: [...tables.messages.values()].map(copy),
    }),
  };
}

/** Everything the memory store holds, for a test to assert on. */
export interface MemoryStoreDump {
  deliveries: StoredDelivery[];
  connections: StoredConnection[];
  conversations: ConversationView[];
  messages: MessageView[];
}

type StoredDelivery = InboxDeliveryView & { bodyHash: string };

interface MemoryTables {
  deliveries: Map<string, StoredDelivery>;
  connections: Map<string, StoredConnection>;
  conversations: Map<string, ConversationView>;
  messages: Map<string, MessageView>;
}

const copy = <T extends object>(row: T): T => ({ ...row });
/** A copy of `row` without `key`: what a real select would not return. */
function without<T extends object, K extends keyof T>(row: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(row).filter(([name]) => name !== key)) as Omit<T, K>;
}
const deliveryView = (row: StoredDelivery): InboxDeliveryView => without(row, "bodyHash");
const connectionView = (row: StoredConnection): ConnectionView => without(row, "credentialSealed");

function memoryInbox({ deliveries }: MemoryTables) {
  return {
    async recordDelivery({ channel, bodyHash, rawBody, receivedAt }) {
      const existing = [...deliveries.values()].find((row) => row.channel === channel && row.bodyHash === bodyHash);
      if (existing) return { id: existing.id, fresh: false };
      const id = randomUUID();
      deliveries.set(id, { id, channel, bodyHash, rawBody, state: "PENDING", attempts: 0, error: null, receivedAt, processedAt: null });
      return { id, fresh: true };
    },
    async getDelivery(id) {
      const row = deliveries.get(id);
      return row ? deliveryView(row) : null;
    },
    async settleDelivery(id, { state, error, at }) {
      const row = deliveries.get(id);
      if (row) deliveries.set(id, { ...row, state, error, processedAt: at, attempts: row.attempts + 1 });
    },
    async listRetryableDeliveries({ receivedBefore, maxAttempts, take }) {
      return [...deliveries.values()]
        .filter((row) => row.state !== "PROCESSED" && row.attempts < maxAttempts && row.receivedAt < receivedBefore)
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
        .slice(0, take)
        .map(deliveryView);
    },
  } satisfies Partial<MessagingStore>;
}

function memoryConnections({ connections }: MemoryTables) {
  const findConnectionByAccount = async (channel: string, externalAccountId: string) => {
    const row = [...connections.values()].find(
      (candidate) => candidate.channel === channel && candidate.externalAccountId === externalAccountId,
    );
    return row ? copy(row) : null;
  };
  return {
    findConnectionByAccount,
    async getConnection(tenantId, id) {
      const row = connections.get(id);
      return row && row.tenantId === tenantId ? copy(row) : null;
    },
    async listConnections(tenantId) {
      return [...connections.values()].filter((row) => row.tenantId === tenantId).map(connectionView);
    },
    async saveConnection(input) {
      const existing = await findConnectionByAccount(input.channel, input.externalAccountId);
      const row: StoredConnection = {
        id: existing?.id ?? randomUUID(),
        ...input,
        status: "CONNECTED",
        statusReason: null,
        revokedAt: null,
      };
      connections.set(row.id, row);
      return connectionView(row);
    },
    async setConnectionStatus(tenantId, id, patch) {
      const row = connections.get(id);
      if (!row || row.tenantId !== tenantId) return false;
      connections.set(id, { ...row, ...patch });
      return true;
    },
  } satisfies Partial<MessagingStore>;
}

function memoryConversations({ conversations }: MemoryTables) {
  const findConversation = async (tenantId: string, channel: string, contactId: string) => {
    const row = [...conversations.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.channel === channel && candidate.contactId === contactId,
    );
    return row ? copy(row) : null;
  };
  return {
    findConversation,
    async getConversation(tenantId, id) {
      const row = conversations.get(id);
      return row && row.tenantId === tenantId ? copy(row) : null;
    },
    async createConversation(input) {
      const existing = await findConversation(input.tenantId, input.channel, input.contactId);
      if (existing) return existing;
      const row: ConversationView = { id: randomUUID(), ...input, summary: null, summaryUpdatedAt: null, createdAt: new Date() };
      conversations.set(row.id, row);
      return copy(row);
    },
    async updateConversation(tenantId, id, patch) {
      const row = conversations.get(id);
      if (!row || row.tenantId !== tenantId) return null;
      const next = { ...row, ...patch };
      conversations.set(id, next);
      return copy(next);
    },
  } satisfies Partial<MessagingStore>;
}

function memoryMessages({ messages }: MemoryTables) {
  const findMessageByExternalId = async (channel: string, externalId: string) => {
    const row = [...messages.values()].find((candidate) => candidate.channel === channel && candidate.externalId === externalId);
    return row ? copy(row) : null;
  };
  return {
    findMessageByExternalId,
    async insertMessage(input) {
      const existing = input.externalId === null ? null : await findMessageByExternalId(input.channel, input.externalId);
      if (existing) return { created: false, message: existing };
      const row: MessageView = {
        id: randomUUID(),
        ...input,
        transcript: null,
        error: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
      };
      messages.set(row.id, row);
      return { created: true, message: copy(row) };
    },
    async updateMessage(tenantId, id, patch) {
      const row = messages.get(id);
      if (!row || row.tenantId !== tenantId) return null;
      const taken = patch.externalId === undefined ? null : await findMessageByExternalId(row.channel, patch.externalId);
      if (taken && taken.id !== id) throw Object.assign(new Error("unique"), { code: "P2002" });
      const next = { ...row, ...patch };
      messages.set(id, next);
      return copy(next);
    },
    async listMessages(tenantId, conversationId) {
      return [...messages.values()]
        .filter((row) => row.tenantId === tenantId && row.conversationId === conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(copy);
    },
    async applyReceipt({ tenantId, channel, externalId, status, at, error }) {
      const row = [...messages.values()].find(
        (candidate) =>
          candidate.tenantId === tenantId &&
          candidate.channel === channel &&
          candidate.externalId === externalId &&
          candidate.direction === "OUTBOUND",
      );
      if (!row) return false;
      const column = RECEIPT_COLUMN[status];
      const stamp = row[column] === null;
      const forward = DELIVERY_RANK[status] > DELIVERY_RANK[row.deliveryStatus];
      messages.set(row.id, {
        ...row,
        ...(stamp ? { [column]: at, ...(error !== null ? { error } : {}) } : {}),
        ...(forward ? { deliveryStatus: status } : {}),
      });
      return true;
    },
  } satisfies Partial<MessagingStore>;
}

function purge({ conversations, messages }: MemoryTables, { cutoff, take }: { cutoff: Date; take: number }) {
  const expired = (row: ConversationView) => row.lastMessageAt !== null && row.lastMessageAt < cutoff;
  const due = [...conversations.values()]
    .filter((row) => row.hasText && expired(row))
    .sort((a, b) => a.lastMessageAt!.getTime() - b.lastMessageAt!.getTime())
    .slice(0, take);
  const ids = new Set(due.map((row) => row.id));
  let purged = 0;
  for (const row of messages.values()) {
    if (!ids.has(row.conversationId) || row.createdAt > cutoff) continue;
    messages.set(row.id, { ...row, body: null, options: null, transcript: null });
    purged += 1;
  }
  for (const row of due) {
    const current = conversations.get(row.id)!;
    if (expired(current)) conversations.set(row.id, { ...current, hasText: false });
  }
  return { conversations: due.length, messages: purged };
}
