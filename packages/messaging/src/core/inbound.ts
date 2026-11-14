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
  if (event.optOut) return { kind: "opted-out", conversationId: conversation.id };

  await notifyHost(ctx, conversation, inserted.message);
  return { kind: "message", conversationId: conversation.id, messageId: inserted.message.id };
}

/** Create the conversation, or bring an existing one up to this message. */
async function openConversation(
  ctx: EngineContext,
  connection: StoredConnection,
  event: InboundMessageEvent,
  carriesText: boolean,
): Promise<ConversationView> {
  const { store } = ctx.config;
  const existing = await store.findConversation(connection.tenantId, connection.channel, event.contactId);
  if (!existing) {
    return store.createConversation({
      tenantId: connection.tenantId,
      channel: connection.channel,
      contactId: event.contactId,
      contactName: event.contactName,
      connectionId: connection.id,
      state: event.optOut ? "OPTED_OUT" : "AGENT",
      lastInboundAt: event.sentAt,
      lastMessageAt: event.sentAt,
      hasText: carriesText,
    });
  }
  const updated = await store.updateConversation(connection.tenantId, existing.id, {
    state: await nextState(ctx, existing, event.optOut),
    connectionId: connection.id,
    lastInboundAt: later(existing.lastInboundAt, event.sentAt),
    lastMessageAt: later(existing.lastMessageAt, event.sentAt),
    ...(event.contactName ? { contactName: event.contactName } : {}),
    ...(carriesText ? { hasText: true } : {}),
  });
  return updated ?? existing;
}

/** An opt-out wins; any other message re-opens a closed or opted-out conversation. */
async function nextState(ctx: EngineContext, conversation: ConversationView, optOut: boolean): Promise<ConversationState> {
  if (optOut) return "OPTED_OUT";
  if (conversation.state !== "OPTED_OUT" && conversation.state !== "CLOSED") return conversation.state;
  return (await ctx.config.hooks?.reopenState?.(conversation)) ?? "AGENT";
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
    ctx.config.logger.error(`messaging.inbound: onInboundMessage failed for ${conversation.id}: ${errorText(error)}`);
  }
}

async function handleOptOut(ctx: EngineContext, connection: StoredConnection, event: OptOutEvent): Promise<EventOutcome> {
  const { store } = ctx.config;
  const existing = await store.findConversation(connection.tenantId, connection.channel, event.contactId);
  if (existing) {
    await store.updateConversation(connection.tenantId, existing.id, { state: "OPTED_OUT" });
    return { kind: "opted-out", conversationId: existing.id };
  }
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
    hasText: false,
  });
  return { kind: "opted-out", conversationId: created.id };
}
