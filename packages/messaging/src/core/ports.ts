import type { ChannelAdapter } from "./channel";
import type { MessagingStore } from "./store";
import type { ConversationState, ConversationView, MessageView } from "./types";

/**
 * What the engine needs FROM its host. The mechanism (the inbox, the tenant
 * resolution, the conversation states, the outbound bookkeeping, the
 * retention) is the engine's and appears nowhere here.
 */

/**
 * Sealing and opening a stored credential. The KEY is the host's: the package
 * never sees it. `open` THROWS on a ciphertext that will not open — a row
 * sealed under a rotated key must fail a send loudly, never read as "no
 * credential".
 */
export interface MessagingSecretsPort {
  seal(plaintext: string): string | Promise<string>;
  open(sealed: string): string | Promise<string>;
}

/**
 * Defer one job run by wire name — the shape of `@12-apps/wiring/ports`'
 * `JobsEnqueuePort`. Never throws. The engine enqueues only its own
 * namespaced job (`messaging.process-delivery`).
 */
export interface MessagingEnqueuePort {
  enqueue(
    name: string,
    payload: unknown,
    options?: { dedupeKey?: string },
  ): Promise<{ enqueued: boolean; reason?: string }>;
}

/** The clock, so a test or a replay decides what "now" is. */
export interface MessagingClockPort {
  now(): Date;
}

/** Where the engine says what it did — the wiring `LoggerPort` shape. Never handed a credential. */
export interface MessagingLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/** What `onInboundMessage` is told: the conversation as it now stands, and the stored message. */
export interface InboundMessageNotice {
  conversation: ConversationView;
  message: MessageView;
}

/** The host's answers to what only it knows about a conversation. All optional. */
export interface MessagingHooks {
  /**
   * A contact's message was stored. The host's agent (or a person's inbox)
   * picks it up here. Called once per stored message, never for a redelivery,
   * and NOT for a message that opted the contact out — nothing may be said to
   * them. Keep it short (enqueue the host's own job): a throw is logged, never
   * retried, because the message is already stored. Default: nothing.
   */
  onInboundMessage?(notice: InboundMessageNotice): Promise<void> | void;
  /**
   * The state a CLOSED or OPTED_OUT conversation re-opens into when its
   * contact writes again. Default: `AGENT`.
   */
  reopenState?(conversation: ConversationView): ConversationState | Promise<ConversationState>;
}

/** Everything a host hands `createMessagingEngine`. */
export interface MessagingEngineConfig {
  store: MessagingStore;
  /** One per channel — `createWhatsAppAdapter(...)` and, later, its siblings. */
  adapters: readonly ChannelAdapter[];
  secrets: MessagingSecretsPort;
  enqueue: MessagingEnqueuePort;
  clock: MessagingClockPort;
  logger: MessagingLogger;
  hooks?: MessagingHooks;
  /**
   * How long a conversation's text is kept after its LAST message, in
   * milliseconds. Default 12 hours: the conversation lives in the contact's
   * own app, not with the tenant.
   */
  retentionMs?: number;
  /** How many conversations one retention pass purges. Default 500. */
  retentionBatchSize?: number;
  /** How many stored deliveries one reconciliation pass re-runs. Default 50. */
  reconcileBatchSize?: number;
  /** How many times a stored delivery may be processed before it is left for a person. Default 5. */
  maxDeliveryAttempts?: number;
  /**
   * How old an unprocessed delivery must be before the reconciliation sweep
   * re-runs it, so the sweep never races the job the webhook just queued.
   * Default 2 minutes.
   */
  reconcileAfterMs?: number;
}

/** The defaults the config's optional numbers take. */
export const MESSAGING_DEFAULTS = {
  retentionMs: 12 * 60 * 60 * 1000,
  retentionBatchSize: 500,
  reconcileBatchSize: 50,
  maxDeliveryAttempts: 5,
  reconcileAfterMs: 2 * 60 * 1000,
} as const;
