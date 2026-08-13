import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
  TransportRecipient,
} from '../../types';

import {
  absoluteLink,
  postOrThrow,
  resolveDriver,
  type DriverDeclarationBase,
} from './drivers';

/**
 * EMAIL transport: formatter + sender behind the driver port.
 *
 *   - `driver: 'resend'` — Resend's HTTP API (plain JSON POST, no SDK):
 *     `apiKey` + `from`.
 *   - `driver: 'log'` — dev/e2e driver: logs the message instead of sending
 *     (explicit opt-in, never a silent default).
 *   - no EMAIL declaration at all — `supports() === false`, router skips it.
 *
 * A different vendor (SES, an SMTP relay…) is one more entry in
 * {@link EMAIL_DRIVERS} — this transport, the router and the registry stay
 * untouched.
 */

/** The channel message an email formatter produces. */
export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

/** The vendor seam: deliver one already-formatted email. Throws on failure. */
export interface EmailDriver {
  send(to: string, message: EmailMessage): Promise<void>;
}

export interface EmailDriverDeclaration extends DriverDeclarationBase {
  channel: 'EMAIL';
  /** Resend: the API key. */
  apiKey?: string;
  /** Resend: the verified `From` address. */
  from?: string;
  /** Where the CTA link points; without it a link is dropped. */
  appUrl?: string;
  /** CTA label. pt-BR product copy by default. */
  linkLabel?: string;
  logger?: NotificationLogger;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const resendDriver = (declaration: EmailDriverDeclaration): EmailDriver => ({
  async send(to, message) {
    if (!declaration.apiKey || !declaration.from) {
      throw new Error('The resend email driver needs both `apiKey` and `from`.');
    }
    await postOrThrow('Resend', declaration.fetchImpl, 'https://api.resend.com/emails', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${declaration.apiKey}`,
      },
      body: JSON.stringify({
        from: declaration.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
  },
});

const logEmailDriver = (declaration: EmailDriverDeclaration): EmailDriver => ({
  // Deliberately logs NO destination address — a recipient e-mail is PII and
  // must never reach logs; the subject alone is enough for local debugging.
  send(_to, message) {
    declaration.logger?.info(
      `[notifications:email] log driver suppressed a real send (subject="${message.subject}")`,
    );
    return Promise.resolve();
  },
});

/** The built-in email vendors. A host adds one by extending this table. */
export const EMAIL_DRIVERS: Record<
  string,
  (declaration: EmailDriverDeclaration) => EmailDriver
> = {
  resend: resendDriver,
  log: logEmailDriver,
};

/**
 * Agnostic content → subject/text/html. The link becomes a trailing CTA, only
 * when an app base URL is configured.
 */
export function formatEmail(
  content: NotificationContent,
  declaration: EmailDriverDeclaration,
): EmailMessage {
  const href = absoluteLink(content.link, declaration.appUrl);
  const label = declaration.linkLabel ?? 'Ver detalhes';
  return {
    subject: content.title,
    text: href ? `${content.body}\n\n${href}` : content.body,
    html: [
      `<p><strong>${escapeHtml(content.title)}</strong></p>`,
      `<p>${escapeHtml(content.body)}</p>`,
      ...(href ? [`<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`] : []),
    ].join('\n'),
  };
}

export function emailTransport(
  declaration: EmailDriverDeclaration,
  extraDrivers: Record<string, (d: EmailDriverDeclaration) => EmailDriver> = {},
): NotificationTransport<EmailMessage> {
  const driver = resolveDriver('EMAIL', declaration, { ...EMAIL_DRIVERS, ...extraDrivers });
  return {
    channel: 'EMAIL',
    supports: (recipient: TransportRecipient) => recipient.email !== null,
    format: (content) => formatEmail(content, declaration),
    async send(message, recipient) {
      if (!recipient.email) throw new Error('Recipient has no email address.');
      await driver.send(recipient.email, message);
    },
  };
}
