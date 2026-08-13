/**
 * The DRIVER port — the reason a host adds a vendor with a config entry and no
 * code (12-15).
 *
 * future-pay's transports each read `process.env` directly:
 * `NOTIFICATIONS_EMAIL_PROVIDER=resend` plus `RESEND_API_KEY`, and a second
 * vendor meant editing the package. That is exactly backwards for a published
 * package — it cannot know a host's variable names, and it must not be the
 * thing that decides whether a channel is on. So a channel is configured by
 * DECLARATION:
 *
 *     transports: [
 *       { channel: 'EMAIL', driver: 'resend', apiKey, from },
 *       { channel: 'SMS',   driver: 'log' },
 *     ]
 *
 * A channel with no declaration reports `supports() === false` and the router
 * skips it: no delivery row, nothing fake-sent. A second vendor is one more
 * entry in the built-in driver table (or `drivers` on the config, for a host's
 * own), and the router, the registry and the other transports are untouched.
 */

import { normalizePhoneE164 } from '../../phone';
import type {
  NotificationContent,
  NotificationTransport,
  TransportRecipient,
} from '../../types';

/** Every HTTP call a built-in driver makes goes through this, so a test can. */
export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Shared by every declaration: which channel, which vendor. */
export interface DriverDeclarationBase {
  /** Vendor key: `resend` / `twilio` / `meta` / `log`, or a host's own. */
  driver: string;
  /**
   * The HTTP client the vendor call uses. Defaults to the global `fetch`.
   * Supplied by tests and by hosts that need a proxy or a retry policy.
   */
  fetchImpl?: FetchImpl;
}

/** A vendor rejection, carrying what the provider actually said. */
export class NotificationProviderError extends Error {
  readonly status: number;
  constructor(vendor: string, status: number, detail: string) {
    super(`${vendor} rejected the message (${status} ${detail}).`);
    this.name = 'NotificationProviderError';
    this.status = status;
    Object.setPrototypeOf(this, NotificationProviderError.prototype);
  }
}

/** `fetch` and throw {@link NotificationProviderError} on a non-2xx. */
export async function postOrThrow(
  vendor: string,
  fetchImpl: FetchImpl | undefined,
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<void> {
  const call = fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const response = await call(url, { method: 'POST', ...init });
  if (!response.ok) {
    throw new NotificationProviderError(vendor, response.status, await response.text());
  }
}

/**
 * Resolve one declaration against a driver table.
 *
 * Returning `null` — an unknown driver name — is a CONFIGURATION error, not a
 * runtime one, so the caller (the transport factory) throws with the names it
 * does know. A typo'd vendor that silently disabled a channel is the failure
 * mode this whole seam exists to remove.
 */
export function resolveDriver<TDeclaration extends DriverDeclarationBase, TDriver>(
  channel: string,
  declaration: TDeclaration,
  table: Record<string, (declaration: TDeclaration) => TDriver>,
): TDriver {
  const factory = table[declaration.driver];
  if (!factory) {
    throw new Error(
      `@12-apps/notifications: unknown ${channel} driver "${declaration.driver}". ` +
        `Known drivers: ${Object.keys(table).sort().join(', ')}.`,
    );
  }
  return factory(declaration);
}

/**
 * Absolutize an in-app link for a channel that leaves the app.
 *
 * A relative path is useless in an inbox and a fabricated localhost link is
 * worse than none, so with no `appUrl` configured the link is simply dropped —
 * future-pay's rule, kept.
 */
export function absoluteLink(link: string | undefined, appUrl: string | undefined): string | null {
  if (!link || !appUrl) return null;
  try {
    return new URL(link, appUrl).toString();
  } catch {
    return null;
  }
}

/**
 * The two PHONE channels' shared skeleton.
 *
 * SMS and WhatsApp differ in their vendor, their message shape and their
 * formatter — and in nothing else: both are unavailable for a recipient whose
 * number will not normalize, both normalize before the vendor ever sees the
 * destination, and both refuse rather than send when it cannot be. Stating that
 * rule twice is how the two drift, which is exactly what happened to the
 * transports' `supports()` gates before they funnelled through one helper.
 */
export function phoneChannel<TMessage>(
  channel: 'SMS' | 'WHATSAPP',
  options: {
    /** Country calling code for a bare local number. */
    defaultCountryCode?: string;
    format: (content: NotificationContent) => TMessage;
    send: (toE164: string, message: TMessage) => Promise<void>;
  },
): NotificationTransport<TMessage> {
  const toE164 = (recipient: TransportRecipient): string | null =>
    normalizePhoneE164(recipient.phone, {
      ...(options.defaultCountryCode !== undefined
        ? { defaultCountryCode: options.defaultCountryCode }
        : {}),
    });
  return {
    channel,
    supports: (recipient) => toE164(recipient) !== null,
    format: options.format,
    async send(message, recipient) {
      const to = toE164(recipient);
      if (!to) throw new Error('Recipient has no usable phone number.');
      await options.send(to, message);
    },
  };
}
