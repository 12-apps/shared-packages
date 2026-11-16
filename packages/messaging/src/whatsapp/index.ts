/**
 * `@12-apps/messaging/whatsapp` — the WhatsApp Cloud API channel adapter.
 *
 * `createWhatsAppAdapter(config)` is what a host hands the engine. The pieces
 * are exported on their own too: the signature check and the receipt parser
 * serve any WhatsApp webhook (a platform notification number), and the
 * Embedded Signup helpers serve the host's connect flow.
 *
 * `@12-apps/notifications` has its own WhatsApp transport, for one-way
 * notification messages. It is deliberately NOT reused here: this adapter
 * carries a conversation (inbound, the service window, opt-out, receipts),
 * which that transport has no model for.
 */

import { serviceWindowPolicy, type ChannelAdapter } from "../core/channel";
import { parseWhatsAppPayload } from "./parse";
import { sendWhatsAppMessage, type GraphConfig } from "./graph";
import { META_SIGNATURE_HEADER, verifyMetaSignature, verifyMetaSubscription } from "./signature";

/** The channel key every WhatsApp row carries. */
export const WHATSAPP_CHANNEL = "whatsapp";

/** WhatsApp's customer service window: free-form messages only within 24 h of the contact's last message. */
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppAdapterConfig {
  /** The Meta app's secret: every webhook POST is signed with it. Empty refuses every delivery. */
  appSecret: string;
  /** The token configured on the app's webhook subscription. Empty refuses every handshake. */
  verifyToken: string;
  /** The Graph API: fetch, base URL and version. */
  graph: GraphConfig;
  /** The whole-message words that opt a contact out. Default: PARAR, SAIR, STOP, CANCELAR. */
  optOutKeywords?: readonly string[];
}

/** The WhatsApp Cloud adapter. */
export function createWhatsAppAdapter(config: WhatsAppAdapterConfig): ChannelAdapter {
  return {
    kind: WHATSAPP_CHANNEL,
    handshake: (query) => verifyMetaSubscription(query, config.verifyToken),
    verify: ({ rawBody, header }) => verifyMetaSignature(rawBody, header(META_SIGNATURE_HEADER), config.appSecret),
    parse: (rawBody) =>
      parseWhatsAppPayload(JSON.parse(rawBody) as unknown, {
        ...(config.optOutKeywords ? { optOutKeywords: config.optOutKeywords } : {}),
      }),
    send: ({ credential, accountId, to, content }) =>
      sendWhatsAppMessage(config.graph, { token: credential, phoneNumberId: accountId, to, content }),
    policy: serviceWindowPolicy(WHATSAPP_SERVICE_WINDOW_MS),
  };
}

export { META_SIGNATURE_HEADER, verifyMetaSignature, verifyMetaSubscription, type MetaHandshake } from "./signature";
export { parseWhatsAppPayload, parseWhatsAppStatuses } from "./parse";
export { DEFAULT_OPT_OUT_KEYWORDS, isOptOutText } from "./opt-out";
export { GraphError, graphRequest, messageBody, sendWhatsAppMessage, type FetchPort, type GraphConfig } from "./graph";
export {
  exchangeSignupCode,
  readSignupAccounts,
  subscribeAppToWaba,
  type MetaAppCredentials,
  type SignupAccount,
  type SignupPhoneNumber,
} from "./signup";
