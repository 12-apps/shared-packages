/**
 * The connector's vocabulary: what every channel adapter normalizes into and
 * what every store reads and writes. Machine words, never copy — a sentence a
 * person reads is the host's.
 */

/** A channel's key: `whatsapp` today; `email`, `slack` when their adapters land. Lowercase, dash-separated. */
export type ChannelKind = string;

/** Whether a connected account can be used. */
export type ConnectionStatus = "CONNECTED" | "REVOKED" | "ERROR";

/**
 * Who answers a conversation:
 * - `AGENT` — the host's automated agent (the `onInboundMessage` hook);
 * - `HUMAN` — a person on the tenant's staff took it over;
 * - `CLOSED` — nobody, until the contact writes again;
 * - `OPTED_OUT` — the contact asked to stop. Nothing is sent until they write again.
 */
export type ConversationState = "AGENT" | "HUMAN" | "CLOSED" | "OPTED_OUT";

export type MessageDirection = "INBOUND" | "OUTBOUND";

/** What a message carries. Templates join when the template story lands. */
export type MessageKind = "TEXT" | "INTERACTIVE" | "AUDIO" | "OTHER";

/**
 * Where a message stands:
 * - `RECEIVED` — an inbound message;
 * - `PENDING` — an outbound row recorded, the channel not yet called;
 * - `ACCEPTED` — the channel took it and returned its id;
 * - `SENT` / `DELIVERED` / `READ` — the channel's own receipts;
 * - `FAILED` — the call failed, or the channel reported a failure.
 */
export type DeliveryStatus = "RECEIVED" | "PENDING" | "ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

/** A receipt a channel reports for an outbound message. */
export type ReceiptStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

/**
 * Who wrote a message. `CONTACT` is the person on the other end of the
 * channel — a buyer, a supplier, a support requester: the host decides what
 * that person is to it.
 */
export type AuthorKind = "CONTACT" | "AGENT" | "STAFF";

/** The structured summary a host keeps beside a conversation. JSON, never free text by convention. */
export type ConversationSummary = { readonly [key: string]: unknown };

/** What an inbound message carried, normalized across channels. */
export type InboundContent =
  | { kind: "TEXT"; text: string }
  /** A tap on a button or a list row the conversation offered. */
  | { kind: "INTERACTIVE"; replyId: string; title: string }
  /** A voice note or an audio file: only the channel's media id, never the bytes. */
  | { kind: "AUDIO"; mediaId: string; mimeType: string | null }
  /** Anything else (an image, a location, a sticker): kept as its channel type, not read. */
  | { kind: "OTHER"; channelType: string };

/** One message a contact sent. */
export interface InboundMessageEvent {
  type: "message";
  /** The channel account it was sent TO (WhatsApp's phone_number_id). */
  accountId: string;
  /** The sender's address on the channel. */
  contactId: string;
  /** The name the channel shows for the sender, when it sends one. */
  contactName: string | null;
  /** The channel's id for the message. */
  externalId: string;
  sentAt: Date;
  content: InboundContent;
  /** The text asked to stop (an opt-out keyword). The message is still stored. */
  optOut: boolean;
}

/** A receipt for a message the tenant sent. */
export interface StatusEvent {
  type: "status";
  accountId: string;
  /** The channel's id of the outbound message. */
  externalId: string;
  status: ReceiptStatus;
  at: Date;
  /** The recipient's address, when the channel says. */
  contactId: string | null;
  /** The channel's error code and title, for a failure. */
  error: string | null;
}

/** The channel's own signal that a contact stopped messages (not a keyword in a text). */
export interface OptOutEvent {
  type: "opt_out";
  accountId: string;
  contactId: string;
  at: Date;
}

export type NormalizedEvent = InboundMessageEvent | StatusEvent | OptOutEvent;

/** A message the tenant sends, normalized across channels. */
export type OutboundContent =
  | { kind: "TEXT"; text: string }
  /** Up to the channel's number of reply buttons under a text. */
  | { kind: "BUTTONS"; text: string; buttons: readonly { id: string; title: string }[] }
  /** A text with one button that opens a list of rows in sections. */
  | {
      kind: "LIST";
      text: string;
      /** The words on the button that opens the list — the host's copy. */
      buttonLabel: string;
      sections: readonly {
        title?: string;
        rows: readonly { id: string; title: string; description?: string }[];
      }[];
    };

/** A connection as the package returns it: never the credential. */
export interface ConnectionView {
  id: string;
  tenantId: string;
  channel: ChannelKind;
  externalAccountId: string;
  externalParentId: string | null;
  displayAddress: string;
  status: ConnectionStatus;
  statusReason: string | null;
  connectedAt: Date;
  revokedAt: Date | null;
}

export interface ConversationView {
  id: string;
  tenantId: string;
  channel: ChannelKind;
  contactId: string;
  contactName: string | null;
  connectionId: string;
  state: ConversationState;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  /** When the contact last opted out (the message's own time, not the processing time). Kept after a re-open. */
  optedOutAt: Date | null;
  hasText: boolean;
  summary: ConversationSummary | null;
  summaryUpdatedAt: Date | null;
  createdAt: Date;
}

export interface MessageView {
  id: string;
  conversationId: string;
  tenantId: string;
  channel: ChannelKind;
  direction: MessageDirection;
  kind: MessageKind;
  /** The text, the tapped choice's title, or an outbound prompt. Null once retention ran. */
  body: string | null;
  /** An outbound interactive message's choices, as JSON text. Null once retention ran. */
  options: string | null;
  /** An audio message's transcript, written by the host. Null once retention ran. */
  transcript: string | null;
  /** An attachment's (or a tapped choice's) id on the channel. */
  attachmentRef: string | null;
  externalId: string | null;
  deliveryStatus: DeliveryStatus;
  authorKind: AuthorKind;
  staffUserId: string | null;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
}

/** The inbox's processing state. */
export type DeliveryState = "PENDING" | "PROCESSED" | "FAILED";

export interface InboxDeliveryView {
  id: string;
  channel: ChannelKind;
  rawBody: string;
  state: DeliveryState;
  attempts: number;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}
