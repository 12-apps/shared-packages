import type { EngineContext } from "./context";
import { errorText } from "./errors";
import type { StoredConnection } from "./store";
import type {
  ConversationState,
  ConversationView,
  InboundContent,
  InboundMessageEvent,
  MessageView,
  NormalizedEvent,
  OptOutEvent,
} from "./types";

/**
 * One normalized event, applied. The tenant is resolved HERE, from the
 * event's channel account against the connections — never from the URL, which
 * for a channel like WhatsApp is one callback shared by every tenant. An
 * account nobody connected, or one revoked or in error, resolves to nobody:
 * the event is dropped (the edge already answered 200, so the channel stops
 * redelivering) and a tenant can never receive another tenant's traffic.
 */

export type EventOutcome =
  | { kind: "dropped"; reason: "unknown-account" | "not-connected" }
  | { kind: "duplicate" }
  | { kind: "message"; conversationId: string; messageId: string }
  | { kind: "opted-out"; conversationId: string }
  | { kind: "receipt"; applied: boolean };

export async function handleEvent(ctx: EngineContext, channel: string, event: NormalizedEvent): Promise<EventOutcome> {
  const connection = await ctx.config.store.findConnectionByAccount(channel, event.accountId);
  if (!connection) return { kind: "dropped", reason: "unknown-account" };
  if (connection.status !== "CONNECTED") return { kind: "dropped", reason: "not-connected" };

  if (event.type === "message") return handleMessage(ctx, connection, event);
  if (event.type === "opt_out") return handleOptOut(ctx, connection, event);
  const applied = await ctx.config.store.applyReceipt({
    tenantId: connection.tenantId,
    channel,
    externalId: event.externalId,
    status: event.status,
    at: event.at,
    error: event.error,
  });
  return { kind: "receipt", applied };
}

/** The text a message row keeps, and the channel reference beside it. */
function columnsOf(content: InboundContent): { kind: InboundContent["kind"]; body: string | null; attachmentRef: string | null } {
  switch (content.kind) {
    case "TEXT":
      return { kind: "TEXT", body: content.text, attachmentRef: null };
    case "INTERACTIVE":
      return { kind: "INTERACTIVE", body: content.title, attachmentRef: content.replyId };
    case "AUDIO":
      return { kind: "AUDIO", body: null, attachmentRef: content.mediaId };
    default:
      return { kind: "OTHER", body: null, attachmentRef: null };
  }
}

const later = (a: Date | null, b: Date): Date => (a && a > b ? a : b);

/** How many times a conversation write is re-decided after losing a compare-and-set. */
const MAX_WRITE_ATTEMPTS = 6;

async function handleMessage(
  ctx: EngineContext,
  connection: StoredConnection,
  event: InboundMessageEvent,
): Promise<EventOutcome> {
  const { store } = ctx.config;
  if (await store.findMessageByExternalId(connection.channel, event.externalId)) return { kind: "duplicate" };

  const columns = columnsOf(event.content);
  const conversation = await openConversation(ctx, connection, event, columns.body !== null);
  const inserted = await store.insertMessage({
    conversationId: conversation.id,
    tenantId: connection.tenantId,
    channel: connection.channel,
    direction: "INBOUND",
    ...columns,
    options: null,
    externalId: event.externalId,
    deliveryStatus: "RECEIVED",
    authorKind: "CONTACT",
    staffUserId: null,
    createdAt: event.sentAt,
  });
  if (!inserted.created) return { kind: "duplicate" };
  // Stored, but nothing may be said: the contact opted out with this message,
  // or this one was sent BEFORE their opt-out and only now got processed.
  if (event.optOut || conversation.state === "OPTED_OUT") return { kind: "opted-out", conversationId: conversation.id };

  await notifyHost(ctx, conversation, inserted.message);
  return { kind: "message", conversationId: conversation.id, messageId: inserted.message.id };
}

/**
 * Create the conversation, or bring an existing one up to this message.
 *
 * Every write to an existing row is a compare-and-set on what was read (its
 * state and its two timestamps): a worker that lost the race re-reads and
 * decides again, so a stale read can never put back a state another worker
 * just changed — an opt-out above all.
 */
async function openConversation(
  ctx: EngineContext,
  connection: StoredConnection,
  event: InboundMessageEvent,
  carriesText: boolean,
): Promise<ConversationView> {
  const { store } = ctx.config;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await store.findConversation(connection.tenantId, connection.channel, event.contactId);
    // A lost insert race answers a null: go again, and the winner's row is `existing`.
    const result = existing
      ? await updateExisting(ctx, connection, existing, event, carriesText)
      : await createFirst(ctx, connection, event, carriesText);
    if (result) return result;
  }
  throw new Error(`conversation ${event.contactId} kept changing under this message; retry`);
}

/** The first message of a contact opens the conversation; null when another worker's insert won. */
async function createFirst(
  ctx: EngineContext,
  connection: StoredConnection,
  event: InboundMessageEvent,
  carriesText: boolean,
): Promise<ConversationView | null> {
  const state = event.optOut ? "OPTED_OUT" : "AGENT";
  const created = await ctx.config.store.createConversation({
    tenantId: connection.tenantId,
    channel: connection.channel,
    contactId: event.contactId,
    contactName: event.contactName,
    connectionId: connection.id,
    state,
    lastInboundAt: event.sentAt,
    lastMessageAt: event.sentAt,
    optedOutAt: event.optOut ? event.sentAt : null,
    hasText: carriesText,
  });
  return created.state === state && created.lastInboundAt?.getTime() === event.sentAt.getTime() ? created : null;
}

/** Bring an existing conversation up to this message; null when the compare-and-set lost. */
async function updateExisting(
  ctx: EngineContext,
  connection: StoredConnection,
  existing: ConversationView,
  event: InboundMessageEvent,
  carriesText: boolean,
): Promise<ConversationView | null> {
  const state = await nextState(ctx, existing, event);
  return ctx.config.store.updateConversation(
    connection.tenantId,
    existing.id,
    {
      // Left out when unchanged: the write never carries a state it did not decide.
      ...(state !== existing.state ? { state } : {}),
      ...(event.optOut ? { optedOutAt: later(existing.optedOutAt, event.sentAt) } : {}),
      ...(connection.id !== existing.connectionId ? { connectionId: connection.id } : {}),
      lastInboundAt: later(existing.lastInboundAt, event.sentAt),
      lastMessageAt: later(existing.lastMessageAt, event.sentAt),
      ...(event.contactName ? { contactName: event.contactName } : {}),
      ...(carriesText ? { hasText: true } : {}),
    },
    { state: existing.state, lastInboundAt: existing.lastInboundAt, lastMessageAt: existing.lastMessageAt, optedOutAt: existing.optedOutAt },
  );
}

/**
 * An opt-out wins. A message re-opens a CLOSED conversation, and an OPTED_OUT
 * one only when it was sent AFTER the opt-out (the message's own time, so a
 * delivery processed late, out of order, never undoes it).
 */
async function nextState(ctx: EngineContext, conversation: ConversationView, event: InboundMessageEvent): Promise<ConversationState> {
  if (event.optOut) return "OPTED_OUT";
  if (conversation.state === "OPTED_OUT") {
    if (conversation.optedOutAt && event.sentAt <= conversation.optedOutAt) return "OPTED_OUT";
  } else if (conversation.state !== "CLOSED") {
    return conversation.state;
  }
  // The type refuses OPTED_OUT; a JavaScript host that returns it anyway is read as the default.
  const chosen = (await ctx.config.hooks?.reopenState?.(conversation)) as ConversationState | undefined;
  return chosen && chosen !== "OPTED_OUT" ? chosen : "AGENT";
}

async function notifyHost(
  ctx: EngineContext,
  conversation: ConversationView,
  message: MessageView,
): Promise<void> {
  const hook = ctx.config.hooks?.onInboundMessage;
  if (!hook) return;
  try {
    await hook({ conversation, message });
  } catch (error) {
    // The message is stored; a retry of the delivery would be a no-op, so the
    // hook's failure is the host's to log and recover from, never a re-run.
    ctx.config.logger.error(`messaging.inbound: onInboundMessage failed for ${conversation.id}: ${errorText(error)}`, { error });
  }
}

async function handleOptOut(ctx: EngineContext, connection: StoredConnection, event: OptOutEvent): Promise<EventOutcome> {
  const { store } = ctx.config;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await store.findConversation(connection.tenantId, connection.channel, event.contactId);
    if (!existing) {
      // No conversation yet: one is opened in OPTED_OUT, so a later send is refused.
      const created = await store.createConversation({
        tenantId: connection.tenantId,
        channel: connection.channel,
        contactId: event.contactId,
        contactName: null,
        connectionId: connection.id,
        state: "OPTED_OUT",
        lastInboundAt: null,
        lastMessageAt: null,
        optedOutAt: event.at,
        hasText: false,
      });
      if (created.state === "OPTED_OUT") return { kind: "opted-out", conversationId: created.id };
      continue;
    }
    const updated = await store.updateConversation(
      connection.tenantId,
      existing.id,
      {
        ...(existing.state !== "OPTED_OUT" ? { state: "OPTED_OUT" as const } : {}),
        optedOutAt: later(existing.optedOutAt, event.at),
      },
      { state: existing.state, lastInboundAt: existing.lastInboundAt, lastMessageAt: existing.lastMessageAt, optedOutAt: existing.optedOutAt },
    );
    if (updated) return { kind: "opted-out", conversationId: existing.id };
  }
  throw new Error(`conversation ${event.contactId} kept changing under this opt-out; retry`);
}
