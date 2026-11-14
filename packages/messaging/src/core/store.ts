import type {
  AuthorKind,
  ChannelKind,
  ConnectionStatus,
  ConnectionView,
  ConversationState,
  ConversationSummary,
  ConversationView,
  DeliveryStatus,
  InboxDeliveryView,
  MessageDirection,
  MessageKind,
  MessageView,
  ReceiptStatus,
} from "./types";

/**
 * THE STORE PORT: every read and write the engine makes, as named operations.
 *
 * The engine never builds a query. Two implementations ship:
 * `createPrismaMessagingStore` over the Prisma delegates generated from the
 * shipped partial (what a host mounts), and `createMemoryMessagingStore` (what
 * a test mounts). The same contract suite runs over both — the Prisma one on
 * real Postgres with the shipped migration — so the two cannot drift.
 *
 * Every operation is tenant-scoped where a tenant is known, and every unique
 * key the migration enforces is enforced by both implementations, with the
 * race answered the same way (the existing row wins).
 */
export interface MessagingStore {
  // ── The inbox ──────────────────────────────────────────────────────────────
  /** Store one raw delivery, deduped on `(channel, bodyHash)`. `fresh: false` for a redelivery. */
  recordDelivery(input: {
    channel: ChannelKind;
    bodyHash: string;
    rawBody: string;
    receivedAt: Date;
  }): Promise<{ id: string; fresh: boolean }>;
  getDelivery(id: string): Promise<InboxDeliveryView | null>;
  /** Close a delivery out, counting the attempt. */
  settleDelivery(id: string, outcome: { state: "PROCESSED" | "FAILED"; error: string | null; at: Date }): Promise<void>;
  /** Deliveries not yet processed, received before `receivedBefore`, under the attempt bound, oldest first. */
  listRetryableDeliveries(input: { receivedBefore: Date; maxAttempts: number; take: number }): Promise<InboxDeliveryView[]>;

  // ── Connections ────────────────────────────────────────────────────────────
  findConnectionByAccount(channel: ChannelKind, externalAccountId: string): Promise<StoredConnection | null>;
  getConnection(tenantId: string, id: string): Promise<StoredConnection | null>;
  listConnections(tenantId: string): Promise<ConnectionView[]>;
  /** Insert, or overwrite the row keyed by `(channel, externalAccountId)`. The engine decides whether it may. */
  saveConnection(input: NewConnection): Promise<ConnectionView>;
  setConnectionStatus(
    tenantId: string,
    id: string,
    patch: { status: ConnectionStatus; statusReason: string | null; revokedAt: Date | null },
  ): Promise<boolean>;

  // ── Conversations ──────────────────────────────────────────────────────────
  findConversation(tenantId: string, channel: ChannelKind, contactId: string): Promise<ConversationView | null>;
  getConversation(tenantId: string, id: string): Promise<ConversationView | null>;
  /** Create one; on a lost race for `(tenant, channel, contact)` the existing row is returned. */
  createConversation(input: NewConversation): Promise<ConversationView>;
  updateConversation(tenantId: string, id: string, patch: ConversationPatch): Promise<ConversationView | null>;

  // ── Messages ───────────────────────────────────────────────────────────────
  findMessageByExternalId(channel: ChannelKind, externalId: string): Promise<MessageView | null>;
  /** Insert one; a duplicate `(channel, externalId)` is `created: false` and the existing row. */
  insertMessage(input: NewMessage): Promise<{ created: boolean; message: MessageView }>;
  updateMessage(tenantId: string, id: string, patch: MessagePatch): Promise<MessageView | null>;
  listMessages(tenantId: string, conversationId: string): Promise<MessageView[]>;
  /**
   * Stamp a receipt on the tenant's outbound message: the receipt's timestamp
   * column is written only while still null (so `(externalId, status)` is
   * deduped by the row itself), and the delivery status only moves forward.
   * False when no outbound message of that tenant has that id.
   */
  applyReceipt(input: {
    tenantId: string;
    channel: ChannelKind;
    externalId: string;
    status: ReceiptStatus;
    at: Date;
    error: string | null;
  }): Promise<boolean>;

  // ── Retention ──────────────────────────────────────────────────────────────
  /**
   * Delete the text of conversations whose last message is older than
   * `cutoff`: ONE indexed query finds up to `take` of them across every tenant
   * (`has_text`, `last_message_at`), then their messages created at or before
   * the cutoff lose `body`, `options` and `transcript`. Conversation rows,
   * states and summaries stay.
   */
  purgeExpiredText(input: { cutoff: Date; take: number }): Promise<{ conversations: number; messages: number }>;
}

/** A connection with its sealed credential: only the engine sees this shape. */
export interface StoredConnection extends ConnectionView {
  credentialSealed: string;
}

export interface NewConnection {
  tenantId: string;
  channel: ChannelKind;
  externalAccountId: string;
  externalParentId: string | null;
  displayAddress: string;
  credentialSealed: string;
  connectedAt: Date;
}

export interface NewConversation {
  tenantId: string;
  channel: ChannelKind;
  contactId: string;
  contactName: string | null;
  connectionId: string;
  state: ConversationState;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  hasText: boolean;
}

export interface ConversationPatch {
  contactName?: string | null;
  connectionId?: string;
  state?: ConversationState;
  lastInboundAt?: Date | null;
  lastMessageAt?: Date | null;
  hasText?: boolean;
  summary?: ConversationSummary;
  summaryUpdatedAt?: Date;
}

export interface NewMessage {
  conversationId: string;
  tenantId: string;
  channel: ChannelKind;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  options: string | null;
  attachmentRef: string | null;
  externalId: string | null;
  deliveryStatus: DeliveryStatus;
  authorKind: AuthorKind;
  staffUserId: string | null;
  createdAt: Date;
}

export interface MessagePatch {
  externalId?: string;
  deliveryStatus?: DeliveryStatus;
  error?: string | null;
  transcript?: string;
  failedAt?: Date;
}

/** The forward order of delivery statuses; FAILED outranks them all. */
export const DELIVERY_RANK: Readonly<Record<DeliveryStatus, number>> = {
  RECEIVED: 0,
  PENDING: 1,
  ACCEPTED: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
  FAILED: 6,
};

/** The receipt's timestamp column. */
export const RECEIPT_COLUMN = {
  SENT: "sentAt",
  DELIVERED: "deliveredAt",
  READ: "readAt",
  FAILED: "failedAt",
} as const satisfies Record<ReceiptStatus, keyof MessageView>;
