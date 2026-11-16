/**
 * The engine's refusals, as typed errors with machine codes. The sentence a
 * person reads for each is the host's copy, keyed by `code`.
 */

/** Why a send was refused or failed. */
export type MessagingSendErrorCode =
  /** The contact opted out; nothing is sent until they write again. */
  | "OPTED_OUT"
  /** The channel's service window is closed (WhatsApp: 24 h after the contact's last message). */
  | "WINDOW_CLOSED"
  /** The conversation's connection is not connected (revoked, in error, or gone). */
  | "NOT_CONNECTED"
  /** No such conversation in this tenant. */
  | "NOT_FOUND"
  /** No adapter for the conversation's channel is mounted. */
  | "UNKNOWN_CHANNEL"
  /** The channel was called and refused or failed; the outbound row is FAILED. */
  | "CHANNEL_FAILED";

export class MessagingSendError extends Error {
  readonly code: MessagingSendErrorCode;
  /** The outbound row, when one was recorded before the failure. */
  readonly messageId: string | null;
  constructor(code: MessagingSendErrorCode, message: string, messageId: string | null = null) {
    super(message);
    this.name = "MessagingSendError";
    this.code = code;
    this.messageId = messageId;
  }
}

/** Why a connection could not be saved. */
export type MessagingConnectErrorCode =
  /** The account is connected to another tenant. */
  | "ACCOUNT_TAKEN"
  /** No adapter for that channel is mounted. */
  | "UNKNOWN_CHANNEL";

export class MessagingConnectError extends Error {
  readonly code: MessagingConnectErrorCode;
  constructor(code: MessagingConnectErrorCode, message: string) {
    super(message);
    this.name = "MessagingConnectError";
    this.code = code;
  }
}

/** The error text a row keeps: bounded, because a channel's error body can be a page. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}
