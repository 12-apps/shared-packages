import type {
  InboundContent,
  InboundMessageEvent,
  NormalizedEvent,
  OptOutEvent,
  ReceiptStatus,
  StatusEvent,
} from "../core/types";
import { DEFAULT_OPT_OUT_KEYWORDS, isOptOutText } from "./opt-out";

/**
 * The WhatsApp Cloud API webhook payload, read defensively: every field is
 * checked before it is trusted, an unknown shape is skipped rather than
 * thrown on, and only `JSON.parse` itself may throw (bytes that are not JSON).
 *
 * Shape: `{ object: "whatsapp_business_account", entry: [{ id, changes: [{
 * field, value: { metadata: { phone_number_id }, contacts, messages,
 * statuses, user_preferences } }] }] }`. Events come out in payload order.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** Meta's timestamps are Unix SECONDS, as a string. Null when absent or malformed. */
function when(value: unknown): Date | null {
  const seconds = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

interface Change {
  value: Json;
  accountId: string;
}

/** Every `value` of every change, with the account it was delivered to. */
function changes(payload: unknown): Change[] {
  if (!isObject(payload) || payload.object !== "whatsapp_business_account") return [];
  return list(payload.entry)
    .flatMap((entry) => list(entry.changes))
    .flatMap((change): Change[] => {
      const value = change.value;
      const accountId = isObject(value) && isObject(value.metadata) ? text(value.metadata.phone_number_id) : null;
      return isObject(value) && accountId ? [{ value, accountId }] : [];
    });
}

/** One reader per message `type`; null when the type's object is missing or malformed. */
const CONTENT_READERS: Readonly<Record<string, (message: Json) => InboundContent | null>> = {
  text: (message) => {
    const body = isObject(message.text) ? text(message.text.body) : null;
    return body ? { kind: "TEXT", text: body } : null;
  },
  interactive: (message) => {
    const interactive = isObject(message.interactive) ? message.interactive : {};
    const reply = interactive.button_reply ?? interactive.list_reply;
    const id = isObject(reply) ? text(reply.id) : null;
    return isObject(reply) && id ? { kind: "INTERACTIVE", replyId: id, title: text(reply.title) ?? "" } : null;
  },
  // A quick-reply button on a template message.
  button: (message) => {
    if (!isObject(message.button)) return null;
    const title = text(message.button.text) ?? "";
    return { kind: "INTERACTIVE", replyId: text(message.button.payload) ?? title, title };
  },
  audio: (message) => {
    const id = isObject(message.audio) ? text(message.audio.id) : null;
    return isObject(message.audio) && id ? { kind: "AUDIO", mediaId: id, mimeType: text(message.audio.mime_type) } : null;
  },
};

/** The content of one message, by its `type`; anything unread is OTHER. */
function contentOf(message: Json): InboundContent {
  const type = text(message.type) ?? "unknown";
  return CONTENT_READERS[type]?.(message) ?? { kind: "OTHER", channelType: type };
}

/** The words a person typed or tapped, for the opt-out check. */
function wordsOf(content: InboundContent): string | null {
  if (content.kind === "TEXT") return content.text;
  if (content.kind === "INTERACTIVE") return content.title;
  return null;
}

/** The profile name Meta sends per sender, keyed by wa_id. */
function contactNames(value: Json): Map<string, string> {
  const names = new Map<string, string>();
  for (const contact of list(value.contacts)) {
    const waId = text(contact.wa_id);
    const name = isObject(contact.profile) ? text(contact.profile.name) : null;
    if (waId && name) names.set(waId, name);
  }
  return names;
}

function messageEvent(
  message: Json,
  accountId: string,
  names: Map<string, string>,
  keywords: readonly string[],
): InboundMessageEvent | null {
  const contactId = text(message.from);
  const externalId = text(message.id);
  const sentAt = when(message.timestamp);
  if (!contactId || !externalId || !sentAt) return null;
  const content = contentOf(message);
  const words = wordsOf(content);
  return {
    type: "message",
    accountId,
    contactId,
    contactName: names.get(contactId) ?? null,
    externalId,
    sentAt,
    content,
    optOut: words !== null && isOptOutText(words, keywords),
  };
}

function messageEvents(value: Json, accountId: string, keywords: readonly string[]): InboundMessageEvent[] {
  const names = contactNames(value);
  return list(value.messages).flatMap((message) => messageEvent(message, accountId, names, keywords) ?? []);
}

const RECEIPTS: Readonly<Record<string, ReceiptStatus>> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/** The first error of a failed status, as `code: title`. */
function errorOf(status: Json): string | null {
  const [first] = list(status.errors);
  if (!first) return null;
  const code = first.code === undefined ? "" : String(first.code);
  const title = text(first.title) ?? text(first.message) ?? "";
  return [code, title].filter(Boolean).join(": ") || null;
}

function statusEvents(value: Json, accountId: string): StatusEvent[] {
  const out: StatusEvent[] = [];
  for (const status of list(value.statuses)) {
    const externalId = text(status.id);
    const receipt = RECEIPTS[text(status.status) ?? ""];
    const at = when(status.timestamp);
    if (!externalId || !receipt || !at) continue;
    out.push({
      type: "status",
      accountId,
      externalId,
      status: receipt,
      at,
      contactId: text(status.recipient_id),
      error: receipt === "FAILED" ? errorOf(status) : null,
    });
  }
  return out;
}

/** Meta's own opt-out: a `user_preferences` change whose value is `stop`. */
function preferenceEvents(value: Json, accountId: string): OptOutEvent[] {
  const out: OptOutEvent[] = [];
  for (const preference of list(value.user_preferences)) {
    const contactId = text(preference.wa_id);
    const at = when(preference.timestamp);
    if (contactId && at && text(preference.value)?.toLowerCase() === "stop") {
      out.push({ type: "opt_out", accountId, contactId, at });
    }
  }
  return out;
}

/**
 * Every event in a WhatsApp webhook payload (already `JSON.parse`d): inbound
 * messages (with the opt-out keyword check), delivery receipts, and Meta's
 * own opt-out signal.
 */
export function parseWhatsAppPayload(
  payload: unknown,
  options: { optOutKeywords?: readonly string[] } = {},
): NormalizedEvent[] {
  const keywords = options.optOutKeywords ?? DEFAULT_OPT_OUT_KEYWORDS;
  const out: NormalizedEvent[] = [];
  for (const { value, accountId } of changes(payload)) {
    out.push(...messageEvents(value, accountId, keywords), ...statusEvents(value, accountId), ...preferenceEvents(value, accountId));
  }
  return out;
}

/**
 * Only the delivery receipts of a WhatsApp webhook payload — for a host that
 * tracks receipts of messages it sends some other way (a platform
 * notification number) without mounting the connector.
 */
export function parseWhatsAppStatuses(payload: unknown): StatusEvent[] {
  return changes(payload).flatMap(({ value, accountId }) => statusEvents(value, accountId));
}
