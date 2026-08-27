import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
  TransportRecipient,
} from '../../types';

import { renderEmail } from '../../email/template';
import type { EmailChromeCopy } from '../../email/template';
import type { EmailTheme } from '../../email/theme';

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
  /**
   * The CTA link's label. REQUIRED — this used to default to `'Ver detalhes'`,
   * so a host that declared EMAIL and nothing else mailed this product's
   * Portuguese to its own users, in their inbox, signed with the host's own
   * `from` address.
   */
  linkLabel: string;
  /**
   * Render through `../../email` — the ONE layout — instead of the three bare
   * `<p>` tags below.
   *
   * OPTIONAL, and its absence is the pre-layout behaviour verbatim. That is
   * deliberate rather than timid: `brand` and `chrome` are REQUIRED with no
   * default anywhere in the layout (a package that defaulted them would sign
   * another company's mail, in a language nobody chose), so a required field
   * here would break every host that already declares EMAIL — at runtime, on
   * the first send, which is the worst place to find out.
   *
   * So the seam is opt-in and the ad-hoc path is what remains for a host that
   * has not taken it. `layout.theme` may still be omitted; `../../email/theme`
   * argues why that one asymmetry is allowed.
   */
  layout?: {
    /** The product name in the header and the footer. */
    brand: string;
    /** The layout's own words. `@12-apps/notifications/email/locales` ships packs. */
    chrome: EmailChromeCopy;
    /** The recipient's language, for the document's `lang` attribute. */
    locale: string;
    /** Defaults to the layout's neutral palette. */
    theme?: EmailTheme;
  };
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
 *
 * Two renderings, and which one runs is the host's choice: with `layout`
 * declared this is the shared document (`../../email`), and without it the
 * three bare `<p>` tags that predate it. See `EmailDriverDeclaration.layout`
 * for why the new path could not simply replace the old one.
 */
export function formatEmail(
  content: NotificationContent,
  declaration: EmailDriverDeclaration,
): EmailMessage {
  const href = absoluteLink(content.link, declaration.appUrl);
  const label = declaration.linkLabel;
  if (declaration.layout) return layoutEmail(content, declaration.layout, href, label);
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

/**
 * The same notification as a laid-out document.
 *
 * The layout escapes and builds the plain-text twin from the SAME object, which
 * is the pair of defects the branch above still carries by construction: its
 * text half is assembled separately, and its `href` reaches the anchor through
 * `escapeHtml` rather than through a scheme check.
 */
function layoutEmail(
  content: NotificationContent,
  layout: NonNullable<EmailDriverDeclaration['layout']>,
  href: string | null,
  label: string,
): EmailMessage {
  const rendered = renderEmail({
    subject: content.title,
    heading: content.title,
    paragraphs: [content.body],
    action: href ? { label, href } : undefined,
    chrome: layout.chrome,
    brand: layout.brand,
    locale: layout.locale,
    theme: layout.theme,
  });
  return { subject: rendered.subject, text: rendered.text, html: rendered.html };
}

export function emailTransport(
  declaration: EmailDriverDeclaration,
  extraDrivers: Record<string, (d: EmailDriverDeclaration) => EmailDriver> = {},
): NotificationTransport<EmailMessage> {
  const driver = resolveDriver('EMAIL', declaration, { ...EMAIL_DRIVERS, ...extraDrivers });
  return {
    channel: 'EMAIL',
    // Truthiness, not `!== null`: an EMPTY STRING is a very ordinary DB value
    // for a nullable column, and it used to pass this gate, earn a delivery row
    // and then fail forever against `send`'s own `!recipient.email` check.
    supports: (recipient: TransportRecipient) => Boolean(recipient.email),
    format: (content) => formatEmail(content, declaration),
    async send(message, recipient) {
      if (!recipient.email) throw new Error('Recipient has no email address.');
      await driver.send(recipient.email, message);
    },
  };
}
