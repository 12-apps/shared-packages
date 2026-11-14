import type { ChannelKind, NormalizedEvent, OutboundContent } from "./types";

/**
 * THE CHANNEL ADAPTER: everything the engine needs to know about one
 * messaging channel, and nothing the engine decides.
 *
 * The engine owns the mechanism — the inbox and its dedupe, the tenant
 * resolution, the conversation and its state, the outbound bookkeeping, the
 * retention. An adapter owns the channel's wire: how a delivery proves where
 * it came from, what its body means, how a message goes out, and when the
 * channel lets a tenant speak first. WhatsApp Cloud is the first adapter
 * (`@12-apps/messaging/whatsapp`); e-mail or a chat workspace join the same
 * way, as one more object of this shape.
 */
export interface ChannelAdapter {
  /** The channel's key, stored on every row: `whatsapp`. Lowercase, dash-separated. */
  readonly kind: ChannelKind;

  /**
   * Answer the channel's subscription handshake (a `GET` with a challenge),
   * or null for a channel that has none. `ok: false` is a refusal (403).
   */
  handshake(query: Readonly<Record<string, string | undefined>>): HandshakeAnswer | null;

  /**
   * Is this delivery really from the channel? Computed over the RAW body
   * bytes, exactly as received. MUST fail closed: a missing secret, a missing
   * header or a malformed one is `false`, never an exception and never `true`.
   */
  verify(delivery: { rawBody: string; header(name: string): string | null }): boolean;

  /**
   * Turn a raw body into normalized events, in the order the channel listed
   * them. A body the adapter does not recognize yields `[]`; a body that is not
   * even JSON throws (the inbox records the failure).
   */
  parse(rawBody: string): NormalizedEvent[];

  /**
   * Send one message from a connected account and report the channel's id
   * for it. Throws {@link ChannelSendFailure} when the channel refuses.
   * `credential` is the OPENED credential: an adapter never logs it, never
   * puts it in an error, never returns it.
   */
  send(input: ChannelSendInput): Promise<{ externalId: string }>;

  /** When this channel lets the tenant send free-form messages. */
  readonly policy: SendPolicy;
}

export type HandshakeAnswer = { ok: true; challenge: string } | { ok: false };

export interface ChannelSendInput {
  /** The opened credential of the connection sending it. */
  credential: string;
  /** The connection's account on the channel (WhatsApp's phone_number_id). */
  accountId: string;
  /** The recipient's address. */
  to: string;
  content: OutboundContent;
}

/** A channel refused or failed a send. `code` is the channel's own, as text. */
export class ChannelSendFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ChannelSendFailure";
    this.code = code;
  }
}

/** What a send policy is asked. */
export interface SendPolicyContext {
  /** When the contact last wrote; null if never. */
  lastInboundAt: Date | null;
  now: Date;
}

export type SendPolicyVerdict = { allowed: true } | { allowed: false; reason: "WINDOW_CLOSED" };

/** A channel's rule for free-form sends. */
export interface SendPolicy {
  check(context: SendPolicyContext): SendPolicyVerdict;
}

/**
 * Is a service window still open? Open while LESS than `windowMs` has passed
 * since the contact's last message: at exactly the window's length it is
 * closed. Never open for a contact who never wrote.
 */
export function isWindowOpen(lastInboundAt: Date | null, now: Date, windowMs: number): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < windowMs;
}

/** A policy that allows free-form sends only inside a window after the contact's last message. */
export function serviceWindowPolicy(windowMs: number): SendPolicy {
  return {
    check: ({ lastInboundAt, now }) =>
      isWindowOpen(lastInboundAt, now, windowMs) ? { allowed: true } : { allowed: false, reason: "WINDOW_CLOSED" },
  };
}

/** A policy for a channel with no window (e-mail): every send is allowed. */
export const OPEN_SEND_POLICY: SendPolicy = { check: () => ({ allowed: true }) };
