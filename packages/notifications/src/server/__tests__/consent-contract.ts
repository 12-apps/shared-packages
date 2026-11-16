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
import type { NotificationConsentApi } from '../consent';
import type { NotificationConsentConfig, ConfirmationMessageInput } from '../consent-types';
import type { PaidChannel } from '../consent-text';
import type { NotificationDeliveryRow, NotificationsDb, NotificationsDbClient } from '../db';

import type { MemoryDb } from './memory-db';

/**
 * FUT-285 (W14 PR-A): the contract suites' shared fixtures.
 *
 * Written before the code, this file used to DECLARE the surface the suites
 * expected and reach it through accessors that failed per case on `main`. The
 * surface exists now, so the shapes are the package's own (imported below) and
 * the accessors are plain reads that still name what is missing if a mount
 * without `consent` is handed to them.
 *
 * Paid channels: SMS and WHATSAPP. A "destination" is the E.164 number the
 * consent was given for — consent belongs to a NUMBER on ONE channel, not to a
 * person, and never to both channels at once (owner, 2026-11-16).
 */

export type { PaidChannel } from '../consent-text';
export type {
  ConfirmationMessageInput,
  ConsentStatus,
  NotificationConsentConfig as ConsentConfig,
} from '../consent-types';
export type { NotificationCapsConfig as CapsConfig } from '../caps';
export type { AppliedDeliveryReceipt as AppliedReceipt } from '../receipts';

/** The mount config the suites pass: any subset of the server config. */
export type ContractConfig = Partial<NotificationsServerConfig>;

/** The delivery row with the two receipt columns. */
type ContractDeliveryRow = NotificationDeliveryRow;

function missing(name: string): Error {
  return new Error(`FUT-285 contract: ${name} is not implemented`);
}

/** `api.consent`, or a failure naming what is missing (a mount with no `consent`). */
export function consentOf(api: ApiNotifications): NotificationConsentApi {
  if (!api.consent) throw missing('api.consent');
  return api.consent;
}

/** `api.applyDeliveryReceipt`. */
export function receiptsOf(api: ApiNotifications): ApiNotifications['applyDeliveryReceipt'] {
  return api.applyDeliveryReceipt;
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
export function clinicConsent(
  overrides: Partial<NotificationConsentConfig> = {},
): NotificationConsentConfig {
  return {
    methods: { SMS: 'CODE', WHATSAPP: 'REPLY' },
    confirmKeywords: ['SIM'],
    optOutKeywords: ['SAIR', 'PARAR', 'STOP', 'CANCELAR'],
    defaultCountryCode: '55',
    message: clinicConfirmation,
    ...overrides,
  };
}

/** Mount with the suites' defaults, overridden by `config`. */
export function mountContract(db: NotificationsDb, config: ContractConfig): ApiNotifications {
  return createApiNotifications({
    categories: ['orders', 'payments'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: mutableContacts(),
    generators: [ORDER_PAID as never],
    logger: silentLogger,
    ...config,
  });
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
