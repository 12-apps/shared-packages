import { createHmac } from "node:crypto";

/**
 * Recorded WhatsApp Cloud API webhook payloads, in the shape Meta posts them
 * (`object` → `entry[]` → `changes[]` → `value`), with the ids replaced by
 * stable fakes. Each builder returns the RAW body string, because the
 * signature is over bytes and a test must sign exactly what it sends.
 */

export const APP_SECRET = "test-app-secret";
export const VERIFY_TOKEN = "test-verify-token";
export const WABA_ID = "102290129340398";
export const PHONE_NUMBER_ID = "106540352242922";
export const OTHER_PHONE_NUMBER_ID = "999000111222333";
export const CONTACT = "5511987654321";

/** 2026-11-14T12:00:00Z, the suites' "now". */
export const NOW = new Date("2026-11-14T12:00:00.000Z");
/** Unix seconds, as Meta sends them. */
export const seconds = (date: Date): string => String(Math.floor(date.getTime() / 1000));

/** `sha256=<hex>` over the raw body with the app secret. */
export function sign(rawBody: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

function envelope(value: Record<string, unknown>, field = "messages", phoneNumberId = PHONE_NUMBER_ID): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: phoneNumberId },
              ...value,
            },
            field,
          },
        ],
      },
    ],
  });
}

const contacts = [{ profile: { name: "Ana Souza" }, wa_id: CONTACT }];

/** A text message from the contact. */
export function textMessage(
  body: string,
  options: { id?: string; at?: Date; phoneNumberId?: string } = {},
): string {
  return envelope(
    {
      contacts,
      messages: [
        {
          from: CONTACT,
          id: options.id ?? "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFjNFQjBDNzE2RTk2MTE5Q0E5QTlBQTkA",
          timestamp: seconds(options.at ?? NOW),
          text: { body },
          type: "text",
        },
      ],
    },
    "messages",
    options.phoneNumberId,
  );
}

/** A tap on a reply button the conversation offered. */
export function buttonReply(id: string, title: string, at: Date = NOW): string {
  return envelope({
    contacts,
    messages: [
      {
        context: { from: "15550783881", id: "wamid.OUTBOUND-PROMPT" },
        from: CONTACT,
        id: "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFkJVVFRPTi1SRVBMWQA",
        timestamp: seconds(at),
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id, title } },
      },
    ],
  });
}

/** A pick from a list message. */
export function listReply(id: string, title: string, at: Date = NOW): string {
  return envelope({
    contacts,
    messages: [
      {
        from: CONTACT,
        id: "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFkxJU1QtUkVQTFkA",
        timestamp: seconds(at),
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id, title, description: "row description" } },
      },
    ],
  });
}

/** A voice note: only the media id travels. */
export function voiceNote(at: Date = NOW): string {
  return envelope({
    contacts,
    messages: [
      {
        from: CONTACT,
        id: "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFkFVRElPLU5PVEUA",
        timestamp: seconds(at),
        type: "audio",
        audio: { mime_type: "audio/ogg; codecs=opus", sha256: "abc", id: "1234567890123456", voice: true },
      },
    ],
  });
}

/** A sticker: a type the connector does not read. */
export function sticker(at: Date = NOW): string {
  return envelope({
    contacts,
    messages: [
      {
        from: CONTACT,
        id: "wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFlNUSUNLRVIA",
        timestamp: seconds(at),
        type: "sticker",
        sticker: { mime_type: "image/webp", sha256: "def", id: "6543210987654321", animated: false },
      },
    ],
  });
}

/** A receipt for an outbound message. */
export function statusUpdate(
  wamid: string,
  status: "sent" | "delivered" | "read" | "failed",
  at: Date = NOW,
  phoneNumberId = PHONE_NUMBER_ID,
): string {
  return envelope(
    {
      statuses: [
        {
          id: wamid,
          status,
          timestamp: seconds(at),
          recipient_id: CONTACT,
          ...(status === "failed"
            ? { errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message" }] }
            : {
                conversation: { id: "CONVERSATION_ID", origin: { type: "service" } },
                pricing: { billable: true, pricing_model: "CBP", category: "service" },
              }),
        },
      ],
    },
    "messages",
    phoneNumberId,
  );
}

/** Meta's own opt-out: the contact stopped marketing messages in the app. */
export function userPreferenceStop(at: Date = NOW): string {
  return envelope(
    {
      contacts,
      user_preferences: [
        { wa_id: CONTACT, detail: "User requested to stop marketing messages", category: "marketing_messages", value: "stop", timestamp: seconds(at) },
      ],
    },
    "user_preferences",
  );
}
