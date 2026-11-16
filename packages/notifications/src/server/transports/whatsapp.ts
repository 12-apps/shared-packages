import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
  TransportSendResult,
} from '../../types';

import {
  absoluteLink,
  fakeProviderId,
  phoneChannel,
  postOrThrow,
  resolveDriver,
  sentAs,
  type DriverDeclarationBase,
} from './drivers';
import { WHATSAPP_CONFIRMATION_CALLBACK_PREFIX } from '../receipts';

/**
 * WHATSAPP transport — Meta's WhatsApp Cloud API behind the driver port.
 *
 *   - `driver: 'meta'` — the Cloud API (JSON POST with a bearer token, no
 *     SDK): `accessToken` + `phoneNumberId`.
 *   - `driver: 'log'` — dev driver: logs instead of sending.
 *   - no WHATSAPP declaration — channel unavailable, router skips it.
 *
 * Template/session-window rule: WhatsApp only accepts FREE-FORM text inside a
 * 24h customer-service window; business-initiated messages outside it require
 * a pre-approved TEMPLATE. With `templateName` set the transport sends that
 * template with two body parameters — {{1}} = title, {{2}} = body (language
 * `templateLanguage`, default `pt_BR`). Without it the transport sends
 * free-form text, and a send outside the session window FAILS with the
 * provider's error recorded on the delivery row — the documented fallback
 * behaviour, visible instead of silent.
 *
 * The window cannot be TRACKED from here (only Meta knows when the customer
 * last wrote), so a host that declares WHATSAPP with no `templateName` and then
 * emits business-initiated notifications has every send rejected. That is
 * visible on the delivery rows, but only once they exist — so the mount warns
 * about the combination the moment the declaration is read, which is the one
 * moment a misconfiguration is cheap to notice.
 */

/**
 * One approved template a single message is sent as, instead of the
 * declaration's generic `templateName`. Set ONLY by the package's own consent
 * engine on the confirmations it builds (from `consent.whatsAppTemplate`): a
 * notification's `data` cannot name one, so a generator that spreads a payload
 * into `data` never changes what Meta is asked to send.
 */
export interface WhatsAppTemplateRef {
  /** The template's name as registered with Meta. */
  name: string;
  /** Its language code; absent = the declaration's `templateLanguage`. */
  language?: string;
  /** The body's {{1}}…{{n}}, in order. */
  bodyParameters: readonly string[];
  /**
   * The payload each QUICK-REPLY button returns, by button index. The button's
   * TITLE is fixed in the approved template and is what arrives as the reply's
   * text; the payload is only a tag the host can recognise it by.
   */
  quickReplyPayloads?: readonly string[];
}

/** The channel message the WhatsApp formatter produces. */
export interface WhatsAppMessage {
  /** Free-form text used inside the session window / without a template. */
  text: string;
  /** Template body parameters ({{1}} title, {{2}} body) when templated. */
  templateParameters: [title: string, body: string];
  /** This message's own template (see {@link WhatsAppTemplateRef}). */
  template?: WhatsAppTemplateRef;
  /**
   * Set by the consent engine on a confirmation message (the consent row's
   * id): sent as `biz_opaque_callback_data`, which Meta echoes on the
   * message's statuses (`confirmationOfWhatsAppStatus`).
   */
  confirmation?: string;
}

export interface WhatsAppDriver {
  /** May answer the provider's id for the message (see `TransportSendResult`). */
  send(toE164: string, message: WhatsAppMessage): Promise<TransportSendResult | void>;
}

export interface WhatsAppDriverDeclaration extends DriverDeclarationBase {
  channel: 'WHATSAPP';
  accessToken?: string;
  phoneNumberId?: string;
  templateName?: string;
  /**
   * The WhatsApp template's language code, e.g. `pt_BR`, `en_US`.
   *
   * REQUIRED: a template is registered with Meta under one language, and
   * sending it with the wrong code is rejected by the Graph API. This defaulted
   * to `pt_BR` — one market's answer — so a host that forgot it did not get a
   * sensible fallback, it got somebody else's template language and a delivery
   * failure it had no reason to expect.
   */
  templateLanguage: string;
  /** Graph API base, so a host can pin a version. */
  graphApiBase?: string;
  appUrl?: string;
  /**
   * Country calling code for a bare local number, digits only (`'55'`, `'1'`).
   * REQUIRED for the same reason SMS requires it — see `../../phone.ts`.
   */
  defaultCountryCode: string;
  logger?: NotificationLogger;
}

const DEFAULT_GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

/**
 * A template BODY parameter as Meta accepts it: no newline or tab, and no run
 * of more than four spaces (Meta rejects the message otherwise, so a first name
 * typed with a line break would fail the send). Each such run becomes one space.
 */
function templateParameterText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, ' ').trim();
}

const bodyParameter = (text: string): { type: 'text'; text: string } => ({
  type: 'text',
  text: templateParameterText(text),
});

function templatePayload(
  toDigits: string,
  message: WhatsAppMessage,
  declaration: WhatsAppDriverDeclaration,
): object {
  return {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: {
      name: declaration.templateName,
      language: { code: declaration.templateLanguage },
      components: [
        {
          type: 'body',
          parameters: message.templateParameters.map(bodyParameter),
        },
      ],
    },
  };
}

/** A message's own template: its body parameters and quick-reply payloads. */
function ownTemplatePayload(
  toDigits: string,
  template: WhatsAppTemplateRef,
  declaration: WhatsAppDriverDeclaration,
): object {
  const components: object[] = [
    {
      type: 'body',
      parameters: template.bodyParameters.map(bodyParameter),
    },
    ...(template.quickReplyPayloads ?? []).map((payload, index) => ({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload }],
    })),
  ];
  return {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language ?? declaration.templateLanguage },
      components,
    },
  };
}

function payloadOf(
  toDigits: string,
  message: WhatsAppMessage,
  declaration: WhatsAppDriverDeclaration,
): object {
  const payload = message.template
    ? ownTemplatePayload(toDigits, message.template, declaration)
    : declaration.templateName
      ? templatePayload(toDigits, message, declaration)
      : textPayload(toDigits, message);
  return message.confirmation
    ? { ...payload, biz_opaque_callback_data: `${WHATSAPP_CONFIRMATION_CALLBACK_PREFIX}${message.confirmation}` }
    : payload;
}

function textPayload(toDigits: string, message: WhatsAppMessage): object {
  return {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'text',
    text: { body: message.text },
  };
}

const metaDriver = (declaration: WhatsAppDriverDeclaration): WhatsAppDriver => ({
  async send(toE164, message) {
    if (!declaration.accessToken || !declaration.phoneNumberId) {
      throw new Error('The meta whatsapp driver needs `accessToken` and `phoneNumberId`.');
    }
    // The Cloud API addresses recipients by bare digits (no `+`).
    const toDigits = toE164.replace('+', '');
    const payload = payloadOf(toDigits, message, declaration);
    const base = declaration.graphApiBase ?? DEFAULT_GRAPH_API_BASE;
    const answer = await postOrThrow(
      'WhatsApp Cloud API',
      declaration.fetchImpl,
      `${base}/${encodeURIComponent(declaration.phoneNumberId)}/messages`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${declaration.accessToken}`,
        },
        body: JSON.stringify(payload),
      },
    );
    // The Cloud API answers `messages[0].id` (a `wamid`): what statuses carry.
    return sentAs((answer as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id);
  },
});

const logWhatsAppDriver = (declaration: WhatsAppDriverDeclaration): WhatsAppDriver => ({
  // Deliberately logs NO destination — a phone number is PII and must never
  // reach logs; the message text alone is enough for local debugging.
  send(_toE164, message) {
    declaration.logger?.info(
      `[notifications:whatsapp] log driver suppressed a real send (text="${message.text}")`,
    );
    return Promise.resolve(fakeProviderId('whatsapp'));
  },
});

export const WHATSAPP_DRIVERS: Record<
  string,
  (declaration: WhatsAppDriverDeclaration) => WhatsAppDriver
> = {
  meta: metaDriver,
  log: logWhatsAppDriver,
};

/** Agnostic content → WhatsApp text + template parameters. */
export function formatWhatsApp(
  content: NotificationContent,
  declaration: WhatsAppDriverDeclaration,
): WhatsAppMessage {
  const lines = [`*${content.title}*`, '', content.body];
  const href = absoluteLink(content.link, declaration.appUrl);
  if (href) lines.push('', href);
  return {
    text: lines.join('\n'),
    templateParameters: [content.title, content.body],
  };
}

export function whatsAppTransport(
  declaration: WhatsAppDriverDeclaration,
  extraDrivers: Record<string, (d: WhatsAppDriverDeclaration) => WhatsAppDriver> = {},
  logger?: NotificationLogger,
): NotificationTransport<WhatsAppMessage> {
  const driver = resolveDriver('WHATSAPP', declaration, {
    ...WHATSAPP_DRIVERS,
    ...extraDrivers,
  });
  if (!declaration.templateName) {
    // Not a throw: free-form IS correct for a host that only replies inside the
    // 24h window. It is a warning because the other reading — business-initiated
    // alerts with no template — is a channel that never delivers anything.
    logger?.error(
      '[notifications] WHATSAPP is declared with no `templateName`: only free-form ' +
        'replies inside the 24h customer-service window will be accepted, and every ' +
        'business-initiated send will be rejected by the Graph API.',
    );
  }
  return phoneChannel<WhatsAppMessage>('WHATSAPP', {
    defaultCountryCode: declaration.defaultCountryCode,
    format: (content) => formatWhatsApp(content, declaration),
    send: (toE164, message) => driver.send(toE164, message),
  });
}
