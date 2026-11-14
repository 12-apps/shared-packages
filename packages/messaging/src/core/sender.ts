import { ChannelSendFailure } from "./channel";
import type { EngineContext } from "./context";
import { errorText, MessagingSendError } from "./errors";
import type { StoredConnection } from "./store";
import type { ConversationView, MessageView, OutboundContent } from "./types";

/** Who is sending: the host's agent, or a person on the tenant's staff. */
export type SendAuthor = { kind: "AGENT" } | { kind: "STAFF"; staffUserId?: string | null };

export interface SendInput {
  tenantId: string;
  conversationId: string;
  content: OutboundContent;
  author: SendAuthor;
}

/**
 * Send one message into a conversation.
 *
 * Refused, with nothing recorded, when the contact opted out, when the
 * channel's policy says the window is closed, or when the conversation's
 * connection is not connected. Otherwise the outbound row is recorded
 * PENDING BEFORE the channel is called — a crash mid-call leaves evidence, not
 * silence — then stamped ACCEPTED with the channel's id, or FAILED with the
 * channel's error (and the error is thrown).
 */
export async function sendMessage(ctx: EngineContext, input: SendInput): Promise<MessageView> {
  const { store, clock } = ctx.config;
  const conversation = await store.getConversation(input.tenantId, input.conversationId);
  if (!conversation) throw new MessagingSendError("NOT_FOUND", `no conversation ${input.conversationId}`);
  const { adapter, connection } = await admit(ctx, conversation);

  const now = clock.now();
  const recorded = await store.insertMessage({
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    channel: conversation.channel,
    direction: "OUTBOUND",
    kind: input.content.kind === "TEXT" ? "TEXT" : "INTERACTIVE",
    body: input.content.text,
    options: optionsOf(input.content),
    attachmentRef: null,
    externalId: null,
    deliveryStatus: "PENDING",
    authorKind: input.author.kind,
    staffUserId: input.author.kind === "STAFF" ? (input.author.staffUserId ?? null) : null,
    createdAt: now,
  });
  await store.updateConversation(conversation.tenantId, conversation.id, {
    lastMessageAt: now,
    hasText: true,
  });

  let externalId: string;
  try {
    const credential = await ctx.config.secrets.open(connection.credentialSealed);
    ({ externalId } = await adapter.send({
      credential,
      accountId: connection.externalAccountId,
      to: conversation.contactId,
      content: input.content,
    }));
  } catch (error) {
    const reason = error instanceof ChannelSendFailure ? `${error.code}: ${error.message}` : errorText(error);
    await store.updateMessage(conversation.tenantId, recorded.message.id, {
      deliveryStatus: "FAILED",
      error: reason.slice(0, 500),
      failedAt: clock.now(),
    });
    throw new MessagingSendError("CHANNEL_FAILED", reason, recorded.message.id);
  }
  const accepted = await store.updateMessage(conversation.tenantId, recorded.message.id, {
    externalId,
    deliveryStatus: "ACCEPTED",
  });
  return accepted ?? recorded.message;
}

/** The checks a send must pass before anything is written. */
async function admit(ctx: EngineContext, conversation: ConversationView) {
  if (conversation.state === "OPTED_OUT") {
    throw new MessagingSendError("OPTED_OUT", `conversation ${conversation.id} opted out`);
  }
  const adapter = ctx.adapters.get(conversation.channel);
  if (!adapter) throw new MessagingSendError("UNKNOWN_CHANNEL", `no adapter for channel "${conversation.channel}"`);
  const verdict = adapter.policy.check({ lastInboundAt: conversation.lastInboundAt, now: ctx.config.clock.now() });
  if (!verdict.allowed) {
    throw new MessagingSendError(verdict.reason, `conversation ${conversation.id}: the channel's window is closed`);
  }
  const connection: StoredConnection | null = await ctx.config.store.getConnection(
    conversation.tenantId,
    conversation.connectionId,
  );
  if (!connection || connection.status !== "CONNECTED") {
    throw new MessagingSendError("NOT_CONNECTED", `conversation ${conversation.id}: its connection is not connected`);
  }
  return { adapter, connection };
}

/** An interactive message's choices, kept as JSON text beside its prompt. */
function optionsOf(content: OutboundContent): string | null {
  if (content.kind === "BUTTONS") return JSON.stringify({ buttons: content.buttons });
  if (content.kind === "LIST") return JSON.stringify({ buttonLabel: content.buttonLabel, sections: content.sections });
  return null;
}
