import { connect, markError, revoke, type ConnectInput } from "./connections";
import { engineContext } from "./context";
import { processDelivery, receiveDelivery, reconcileInbox } from "./inbox";
import type { MessagingEngineConfig } from "./ports";
import { sweepRetention } from "./retention";
import { sendMessage, type SendInput } from "./sender";
import type { ConversationState, ConversationSummary } from "./types";

/**
 * Mount the connector: one engine per process, over the host's store and
 * ports, with one adapter per channel.
 */
export function createMessagingEngine(config: MessagingEngineConfig) {
  const ctx = engineContext(config);
  const { store, clock } = ctx.config;
  return {
    /** The adapter mounted for a channel, or undefined. */
    adapter: (channel: string) => ctx.adapters.get(channel),
    /** The channels this engine serves. */
    channels: () => [...ctx.adapters.keys()],

    // ── The pipeline ─────────────────────────────────────────────────────────
    /** Store a VERIFIED raw delivery and queue its processing. The edge answers 200 after this. */
    receive: (channel: string, rawBody: string) => receiveDelivery(ctx, channel, rawBody),
    /** The `process-delivery` job's body. */
    processDelivery: (deliveryId: string) => processDelivery(ctx, deliveryId),
    /** The `reconcile-inbox` sweep's body. */
    reconcile: () => reconcileInbox(ctx),
    /** The `retention` sweep's body. */
    sweepRetention: () => sweepRetention(ctx),

    // ── Sending ──────────────────────────────────────────────────────────────
    send: (input: SendInput) => sendMessage(ctx, input),

    // ── Connections ──────────────────────────────────────────────────────────
    connect: (input: ConnectInput) => connect(ctx, input),
    revoke: (tenantId: string, connectionId: string, reason?: string | null) => revoke(ctx, tenantId, connectionId, reason),
    markError: (tenantId: string, connectionId: string, reason: string) => markError(ctx, tenantId, connectionId, reason),
    listConnections: (tenantId: string) => store.listConnections(tenantId),

    // ── Conversations, for the host's own surfaces ───────────────────────────
    getConversation: (tenantId: string, conversationId: string) => store.getConversation(tenantId, conversationId),
    listMessages: (tenantId: string, conversationId: string) => store.listMessages(tenantId, conversationId),
    /**
     * Move a conversation between AGENT, HUMAN and CLOSED (a hand-off). OPTED_OUT
     * is the contact's alone, both ways: an opted-out conversation is not
     * moved (null), and only the contact's next message re-opens it.
     */
    setState: (tenantId: string, conversationId: string, state: Exclude<ConversationState, "OPTED_OUT">) =>
      // ONE guarded write: an opt-out landing between a read and this write cannot be overwritten.
      store.updateConversation(tenantId, conversationId, { state }, { stateNot: "OPTED_OUT" }),
    /** Replace the structured summary that outlives the text. */
    setSummary: (tenantId: string, conversationId: string, summary: ConversationSummary) =>
      store.updateConversation(tenantId, conversationId, { summary, summaryUpdatedAt: clock.now() }),
    /** Store an audio message's transcript (deleted with the text). */
    setTranscript: async (tenantId: string, messageId: string, transcript: string) => {
      const message = await store.updateMessage(tenantId, messageId, { transcript });
      if (message) await store.updateConversation(tenantId, message.conversationId, { hasText: true });
      return message;
    },
  };
}

export type MessagingEngine = ReturnType<typeof createMessagingEngine>;
