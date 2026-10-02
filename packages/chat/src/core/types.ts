/**
 * The wire vocabulary both halves share — what the routes answer and what the
 * thread screen reads. Framework-free, so every bundle may import it.
 *
 * A participant is known to the others ONLY by its role's label: no person
 * id, no name, no contact detail ever crosses the wire. That is the point of
 * the package, not a detail of it.
 */

/** One message as a participant sees it. */
export interface ChatWireMessage {
  readonly id: string;
  /** The author's role key (host vocabulary). */
  readonly role: string;
  /** The author's role LABEL — the only name the thread ever shows. */
  readonly label: string;
  /** Whether the caller wrote it (or, for a shared role, the caller's role did). */
  readonly mine: boolean;
  readonly body: string;
  /** ISO-8601. */
  readonly createdAt: string;
}

/** A canned line a role may send with one tap. */
export interface ChatQuickReply {
  readonly key: string;
  readonly text: string;
}

/** What the caller may do in the thread, decided by the host per request. */
export interface ChatWireThread {
  readonly me: { readonly role: string; readonly label: string };
  readonly canWrite: boolean;
  /** False ⇒ the caller may only send quick replies. */
  readonly freeText: boolean;
  readonly maxLength: number;
  readonly quickReplies: readonly ChatQuickReply[];
}

/** `GET` — the thread and its messages, oldest first. */
export interface ChatThreadPayload {
  readonly thread: ChatWireThread;
  readonly messages: readonly ChatWireMessage[];
  /** Messages by others since the caller last read. */
  readonly unread: number;
}

/** Machine codes a refused send answers with, beside the host's sentence. */
export type ChatErrorCode =
  | "unauthenticated"
  | "not_found"
  | "closed"
  | "invalid_body"
  | "empty"
  | "too_long"
  | "free_text_disabled"
  | "unknown_quick_reply"
  | "contact_info"
  | "rate_limited";

/** The body of every refusal. */
export interface ChatWireError {
  readonly error: ChatErrorCode;
  readonly message: string;
}
