/* eslint-disable test-flakiness/no-global-state-mutation --
   the fakes below RECORD what crossed them (sends, hook calls, statement
   counts); appending to those arrays is what the assertions read, and every
   suite builds fresh ones per case. */
import { CLINIC_MESSAGES } from '../../__tests__/host-copy';
import type {
  NotificationChannel,
  NotificationContent,
  NotificationTransport,
  TransportRecipient,
} from '../../types';
import {
  createApiNotifications,
  type ApiNotifications,
  type NotificationsServerConfig,
} from '../create-api-notifications';
import type { NotificationsDb, NotificationsDbClient } from '../db';

import type { MemoryDb } from './memory-db';

/**
 * FUT-285 (W14 PR-A): the CONTRACT's surface, written before the code.
 *
 * Every name below is what the implementation must expose. The suites reach it
 * through the accessors here rather than through direct imports so that the
 * contract compiles and RUNS against `main` and fails there for the missing
 * behaviour — a missing export is reported per case ("not implemented: …"),
 * never as a file that does not load. When the implementation lands, the
 * accessors can be replaced by direct imports; the assertions stay as written.
 *
 * Paid channels: SMS and WHATSAPP. A "destination" is the E.164 number the
 * consent was given for — consent belongs to a NUMBER on ONE channel, not to a
 * person, and never to both channels at once (owner, 2026-11-16).
 */

export type PaidChannel = 'SMS' | 'WHATSAPP';

/** How a channel is confirmed: a reply on the channel, or a code typed in the app. */
export type ConfirmMethod = 'REPLY' | 'CODE';

export type ConsentStatus = 'NONE' | 'PENDING' | 'CONFIRMED' | 'GRANDFATHERED' | 'OPTED_OUT';

/** One (user, channel) as `api.consent.get` reports it. */
interface ConsentView {
  status: ConsentStatus;
  method: ConfirmMethod | 'GRANDFATHERED' | null;
  /** E.164, or null when there is no row. */
  destination: string | null;
  confirmedAt: Date | null;
  optedOutAt: Date | null;
  /** The consent RECORD a reply leaves: what was typed, its provider id, when. */
  record: { text: string | null; externalId: string | null; at: Date } | null;
}

/** What the host's copy builder is asked for — the package names no product. */
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

interface ConfirmationResult {
  status: 'SENT' | 'COOLDOWN' | 'DAILY_LIMIT' | 'CAP' | 'NO_PHONE' | 'ALREADY_CONFIRMED';
  /** With COOLDOWN (and SENT): how long until the next send is allowed. */
  retryAfterMs?: number;
}

interface CodeResult {
  status: 'CONFIRMED' | 'WRONG' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'NO_PENDING';
  attemptsLeft?: number;
}

interface InboundInput {
  channel: PaidChannel;
  /** The sender, as the provider reports it: E.164 or bare digits. */
  from: string;
  /** What the person typed, or the title of the reply button they tapped. */
  text?: string;
  /** A provider's own stop signal (Meta `user_preferences: stop`). */
  optOut?: boolean;
  at: Date;
  /** The provider's id for the inbound message. */
  externalId: string;
}

interface InboundResult {
  outcome: 'CONFIRMED' | 'OPTED_OUT' | 'IGNORED';
  /** Every account whose (channel, destination) row the message changed. */
  userIds: string[];
}

interface ConsentApi {
  get(userId: string): Promise<Record<PaidChannel, ConsentView>>;
  request(userId: string, channel: PaidChannel): Promise<ConfirmationResult>;
  resend(userId: string, channel: PaidChannel): Promise<ConfirmationResult>;
  confirmCode(userId: string, channel: PaidChannel, code: string): Promise<CodeResult>;
  applyInbound(input: InboundInput): Promise<InboundResult>;
  forgetDestination(userId: string): Promise<void>;
  grandfather(entries: { userId: string; channel: PaidChannel }[]): Promise<{ created: number }>;
  askGrandfathered(options?: { take?: number }): Promise<{ asked: number }>;
}

export interface ConsentConfig {
  methods: Partial<Record<PaidChannel, ConfirmMethod>>;
  confirmKeywords: readonly string[];
  optOutKeywords: readonly string[];
  /** Digits only — the package assumes no country (see `../../phone.ts`). */
  defaultCountryCode: string;
  message: (input: ConfirmationMessageInput) => NotificationContent;
  resendCooldownMs?: number;
  maxSendsPerDay?: number;
  codeTtlMs?: number;
  maxCodeAttempts?: number;
}

export interface CapsConfig {
  channels?: readonly PaidChannel[];
  perRecipientDaily?: () => number | Promise<number>;
  perTenantMonthly?: (tenantId: string) => number | Promise<number>;
  /** The person's day is counted in this zone. Required: no market is assumed. */
  timeZone: string;
  /** The tenant's month is counted in ITS zone; absent = `timeZone`. */
  timeZoneOf?: (tenantId: string) => string | Promise<string>;
  onTenantCapReached?: (tenantId: string, period: string) => void | Promise<void>;
}

type ReceiptStatus = 'SENT' | 'DELIVERED' | 'READ' | 'UNDELIVERED';

interface DeliveryReceiptInput {
  channel: PaidChannel;
  providerMessageId: string;
  status: ReceiptStatus;
  at: Date;
  error?: string | null;
  /** The provider said the number itself is bad (invalid, landline, unknown). */
  permanent?: boolean;
}

export interface AppliedReceipt {
  deliveryId: string;
  notificationId: string;
  userId: string;
  channel: PaidChannel;
  status: 'DELIVERED' | 'UNDELIVERED';
  at: Date;
  error: string | null;
  permanent: boolean;
}

/** The mount config the contract adds to `NotificationsServerConfig`. */
export interface ContractConfig extends Partial<NotificationsServerConfig> {
  requireConsent?: readonly PaidChannel[];
  consent?: ConsentConfig;
  caps?: CapsConfig;
  onDeliveryReceipt?: (receipt: AppliedReceipt) => void;
}

/** The delivery row with the two columns the contract adds. */
interface ContractDeliveryRow {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  error: string | null;
  attempts: number;
  sentAt: Date | null;
  updatedAt: Date;
  providerMessageId?: string | null;
  deliveredAt?: Date | null;
}

function missing(name: string): Error {
  return new Error(`FUT-285 contract: ${name} is not implemented`);
}

/** `api.consent`, or a failure naming what is missing. */
export function consentOf(api: ApiNotifications): ConsentApi {
  const consent = (api as unknown as { consent?: ConsentApi }).consent;
  if (!consent) throw missing('api.consent');
  return consent;
}

/** `api.applyDeliveryReceipt`, or a failure naming what is missing. */
export function receiptsOf(
  api: ApiNotifications,
): (input: DeliveryReceiptInput) => Promise<{ applied: boolean }> {
  const apply = (api as unknown as {
    applyDeliveryReceipt?: (input: DeliveryReceiptInput) => Promise<{ applied: boolean }>;
  }).applyDeliveryReceipt;
  if (!apply) throw missing('api.applyDeliveryReceipt');
  return apply;
}

/** One named export of a module, or a failure naming what is missing. */
export function exportOf<T>(module: object, name: string): T {
  const value = (module as Record<string, unknown>)[name];
  if (value === undefined) throw missing(`the export \`${name}\``);
  return value as T;
}

const silentLogger = { info: () => undefined, error: () => undefined };

/** The people of these suites. u1 and u3 share ONE phone (a family number). */
const PEOPLE: Record<
  string,
  { email: string | null; phone: string | null; firstName?: string | null }
> = {
  u1: { email: 'ana@example.com', phone: '+5511987654321', firstName: 'Ana' },
  u2: { email: 'bia@example.com', phone: '+5531999998888', firstName: 'Bia' },
  // The same number as u1, typed the way a person types it.
  u3: { email: 'caio@example.com', phone: '(11) 98765-4321', firstName: 'Caio' },
  'u-nophone': { email: 'nophone@example.com', phone: null },
};

/** u1's (and u3's) number in E.164 — what a provider reports as the sender. */
export const U1_E164 = '+5511987654321';

/** A contact directory over a MUTABLE table, so a case can change a phone. */
export function mutableContacts(people = structuredClone(PEOPLE)): {
  people: typeof people;
  getContact: (userId: string) => Promise<{
    email: string | null;
    phone: string | null;
    firstName?: string | null;
  } | null>;
} {
  return { people, getContact: (userId) => Promise.resolve(people[userId] ?? null) };
}

/** One send a fake phone transport performed. */
export interface PhoneSend {
  channel: NotificationChannel;
  userId: string;
  phone: string | null;
  text: string;
  providerMessageId: string;
}

/**
 * A paid-channel transport that answers a provider id per send, the way the
 * widened `send()` must (`Promise<{ providerMessageId } | void>`).
 */
export function phoneTransport(
  channel: PaidChannel,
  sends: PhoneSend[],
  options: { fail?: () => boolean } = {},
): NotificationTransport<{ text: string }> {
  let sequence = 0;
  const transport = {
    channel,
    supports: (recipient: TransportRecipient) => recipient.phone !== null,
    format: (content: NotificationContent) => ({ text: `${content.title}|${content.body}` }),
    send: (message: { text: string }, recipient: TransportRecipient) => {
      if (options.fail?.()) return Promise.reject(new Error(`${channel} provider down`));
      sequence += 1;
      const providerMessageId = `${channel.toLowerCase()}-msg-${sequence}`;
      sends.push({
        channel,
        userId: recipient.userId,
        phone: recipient.phone,
        text: message.text,
        providerMessageId,
      });
      return Promise.resolve({ providerMessageId });
    },
  };
  return transport as unknown as NotificationTransport<{ text: string }>;
}

/** A free-channel transport, recording the user ids it reached. */
export function emailTransport(sent: string[]): NotificationTransport<{ text: string }> {
  return {
    channel: 'EMAIL',
    supports: (recipient) => recipient.email !== null,
    format: (content) => ({ text: content.title }),
    send: (_message, recipient) => {
      sent.push(recipient.userId);
      return Promise.resolve();
    },
  };
}

const ORDER_PAID = {
  type: 'order.paid',
  category: 'orders',
  generate: (payload: { code: string }) => ({
    title: 'Pagamento confirmado',
    body: `Pedido ${payload.code} pago.`,
  }),
};

/**
 * The host's confirmation copy. A fictional clinic's words: the package must
 * send whatever the HOST builds, and these strings exist nowhere in it.
 */
export function clinicConfirmation(input: ConfirmationMessageInput): NotificationContent {
  const name = input.firstName ? `${input.firstName}, ` : '';
  return input.method === 'CODE'
    ? { title: 'Clínica', body: `${name}seu código é ${input.code ?? ''}` }
    : { title: 'Clínica', body: `${name}quer receber lembretes das vacinas aqui? Responda SIM.` };
}

/** The consent block every consent suite mounts with. */
export function clinicConsent(overrides: Partial<ConsentConfig> = {}): ConsentConfig {
  return {
    methods: { SMS: 'CODE', WHATSAPP: 'REPLY' },
    confirmKeywords: ['SIM'],
    optOutKeywords: ['SAIR', 'PARAR', 'STOP', 'CANCELAR'],
    defaultCountryCode: '55',
    message: clinicConfirmation,
    ...overrides,
  };
}

/** Mount with the contract's extra config keys (ignored by `main`, so it fails there). */
export function mountContract(db: NotificationsDb, config: ContractConfig): ApiNotifications {
  return createApiNotifications({
    categories: ['orders', 'payments'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: mutableContacts(),
    generators: [ORDER_PAID as never],
    logger: silentLogger,
    ...config,
  } as NotificationsServerConfig);
}

/** The 6-digit code inside the last CODE confirmation sent on `channel`. */
export function lastCode(sends: readonly PhoneSend[], channel: PaidChannel): string {
  const send = [...sends].reverse().find((entry) => entry.channel === channel);
  const code = send?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no ${channel} code was sent`);
  return code;
}

/** The delivery rows of one notification, with the contract's columns. */
export function deliveriesOf(db: MemoryDb, notificationId: string): ContractDeliveryRow[] {
  return db.rows.deliveries.filter(
    (row) => row.notificationId === notificationId,
  ) as ContractDeliveryRow[];
}

/**
 * Wrap a db so every delegate call is COUNTED — the query budget, measured.
 * Calls made through a `$transaction`'s client count too.
 */
export function countingDb(inner: NotificationsDb): { db: NotificationsDb; calls: () => number; reset: () => void } {
  let count = 0;
  const wrapClient = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, model, receiver) {
        const delegate = Reflect.get(target, model, receiver) as unknown;
        if (model === '$transaction') {
          return (fn: (tx: NotificationsDbClient) => Promise<unknown>) =>
            inner.$transaction((tx) => fn(wrapClient(tx)));
        }
        if (typeof delegate !== 'object' || delegate === null) return delegate;
        return new Proxy(delegate, {
          get(delegateTarget, method, delegateReceiver) {
            const fn = Reflect.get(delegateTarget, method, delegateReceiver) as unknown;
            if (typeof fn !== 'function') return fn;
            return (...args: unknown[]) => {
              count += 1;
              return (fn as (...a: unknown[]) => unknown).apply(delegateTarget, args);
            };
          },
        });
      },
    });
  return {
    db: wrapClient(inner),
    calls: () => count,
    reset: () => {
      count = 0;
    },
  };
}
