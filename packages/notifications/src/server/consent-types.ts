import type { NotificationContent, NotificationLogger } from '../types';

import type { CapsGate } from './caps';
import type { ChannelConsentDelegate } from './consent-db';
import type { PaidChannel } from './consent-text';
import type { NotificationContactDirectory, NotificationsDbProvider } from './db';
import type { WhatsAppTemplateRef } from './transports/whatsapp';
import type { TransportRegistry } from './transports/registry';

/**
 * The consent engine's public vocabulary. See `./consent.ts` for the
 * rules; this file only names the shapes, so the engine's parts can share them.
 */

/** How a channel is confirmed: a reply on the channel, or a code typed in the app. */
export type ConfirmMethod = 'REPLY' | 'CODE';

/** A (user, channel) as the engine reports it; `NONE` = no consent for the current number. */
export type ConsentStatus = 'NONE' | 'PENDING' | 'CONFIRMED' | 'GRANDFATHERED' | 'OPTED_OUT';

export interface ConsentView {
  status: ConsentStatus;
  method: ConfirmMethod | 'GRANDFATHERED' | null;
  /** E.164, or null when there is no consent for the current number. */
  destination: string | null;
  confirmedAt: Date | null;
  optedOutAt: Date | null;
  /** What the person did to consent: the reply's text and provider id, and when. */
  record: { text: string | null; externalId: string | null; at: Date } | null;
}

/** What the host's copy builder is asked for — the package words nothing. */
export interface ConfirmationMessageInput {
  channel: PaidChannel;
  method: ConfirmMethod;
  /** The plain code, for the CODE method only. Never stored. */
  code?: string;
  /** The account's first name, when the contact directory gives one. */
  firstName?: string | null;
  locale?: string | null;
  reason: 'REQUEST' | 'RESEND' | 'GRANDFATHERED';
}

export interface ConfirmationResult {
  status: 'SENT' | 'COOLDOWN' | 'DAILY_LIMIT' | 'CAP' | 'NO_PHONE' | 'ALREADY_CONFIRMED';
  /** With SENT and COOLDOWN: how long until the next send is allowed. */
  retryAfterMs?: number;
}

export interface CodeResult {
  status: 'CONFIRMED' | 'WRONG' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'NO_PENDING';
  attemptsLeft?: number;
}

export interface InboundConsentInput {
  channel: PaidChannel;
  /** The sender as the provider reports it: E.164 or bare international digits. */
  from: string;
  /** What the person typed, or the title of the reply button they tapped. */
  text?: string;
  /** A provider's own stop signal (Meta `user_preferences: stop`, a carrier STOP). */
  optOut?: boolean;
  at: Date;
  /** The provider's id for the inbound message — kept as the consent record. */
  externalId: string;
}

export interface InboundConsentResult {
  outcome: 'CONFIRMED' | 'OPTED_OUT' | 'IGNORED';
  /** Every account whose (channel, number) consent the message changed. */
  userIds: string[];
}

export interface NotificationConsentConfig {
  /** How each paid channel is confirmed. A channel with none cannot be required. */
  methods: Partial<Record<PaidChannel, ConfirmMethod>>;
  /** The whole-reply words that confirm (e.g. the host's "yes"). Required, non-empty. */
  confirmKeywords: readonly string[];
  /** The whole-reply words that opt out. Required, non-empty. */
  optOutKeywords: readonly string[];
  /** Digits only, for a stored phone with no country (see `../phone.ts`). */
  defaultCountryCode: string;
  /** The confirmation's words, built by the host per send. */
  message: (input: ConfirmationMessageInput) => NotificationContent;
  /**
   * The approved WhatsApp TEMPLATE a confirmation goes out as. A confirmation
   * is business-initiated, so outside the 24 h window Meta accepts only an
   * approved template — and the confirmation's (a question with a reply
   * button) is not the declaration's generic alert template. The host
   * registers it and answers its name and parameters here, per send (the
   * parameters usually carry the first name). Absent, or answering `null`, the
   * confirmation goes out like any other WhatsApp message of the mount.
   */
  whatsAppTemplate?: (input: ConfirmationMessageInput) => WhatsAppTemplateRef | null;
  /** Between two confirmation sends of one (user, channel). Default 60 s. */
  resendCooldownMs?: number;
  /** Confirmation sends of one (user, channel) in 24 h, the first included. Default 3. */
  maxSendsPerDay?: number;
  /** How long a code lives. Default 10 min. */
  codeTtlMs?: number;
  /** Wrong codes before the code is dead. Default 5. */
  maxCodeAttempts?: number;
}

/** The config with its defaults applied, and the keywords folded. */
export interface ResolvedConsentConfig extends NotificationConsentConfig {
  resendCooldownMs: number;
  maxSendsPerDay: number;
  codeTtlMs: number;
  maxCodeAttempts: number;
  words: { confirm: ReadonlySet<string>; optOut: ReadonlySet<string> };
}

/** What every part of the engine reads. */
export interface ConsentDeps {
  db: NotificationsDbProvider;
  contacts: NotificationContactDirectory;
  transports: TransportRegistry;
  config: ResolvedConsentConfig;
  caps: CapsGate | null;
  logger: NotificationLogger;
}

/** The consent delegate, or a loud refusal naming what the seam lacks. */
export async function consentStore(deps: Pick<ConsentDeps, 'db'>): Promise<ChannelConsentDelegate> {
  const delegate = (await deps.db()).notificationChannelConsent;
  if (!delegate) {
    throw new Error(
      '@12-apps/notifications: `consent` needs the `notificationChannelConsent` delegate on the db seam.',
    );
  }
  return delegate;
}
