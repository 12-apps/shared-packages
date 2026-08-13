import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
} from '../../types';

import {
  absoluteLink,
  phoneChannel,
  postOrThrow,
  resolveDriver,
  type DriverDeclarationBase,
} from './drivers';

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

/** The channel message the WhatsApp formatter produces. */
export interface WhatsAppMessage {
  /** Free-form text used inside the session window / without a template. */
  text: string;
  /** Template body parameters ({{1}} title, {{2}} body) when templated. */
  templateParameters: [title: string, body: string];
}

export interface WhatsAppDriver {
  send(toE164: string, message: WhatsAppMessage): Promise<void>;
}

export interface WhatsAppDriverDeclaration extends DriverDeclarationBase {
  channel: 'WHATSAPP';
  accessToken?: string;
  phoneNumberId?: string;
  templateName?: string;
  /** Default `pt_BR`. */
  templateLanguage?: string;
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
      language: { code: declaration.templateLanguage ?? 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: message.templateParameters.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };
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
    const payload = declaration.templateName
      ? templatePayload(toDigits, message, declaration)
      : textPayload(toDigits, message);
    const base = declaration.graphApiBase ?? DEFAULT_GRAPH_API_BASE;
    await postOrThrow(
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
  },
});

const logWhatsAppDriver = (declaration: WhatsAppDriverDeclaration): WhatsAppDriver => ({
  // Deliberately logs NO destination — a phone number is PII and must never
  // reach logs; the message text alone is enough for local debugging.
  send(_toE164, message) {
    declaration.logger?.info(
      `[notifications:whatsapp] log driver suppressed a real send (text="${message.text}")`,
    );
    return Promise.resolve();
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
  return { text: lines.join('\n'), templateParameters: [content.title, content.body] };
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
