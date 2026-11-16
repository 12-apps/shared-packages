import type { NotificationChannel } from '../types';

import type { ChannelConsentDelegate, ChannelConsentRow } from './consent-db';
import type { NotificationRejectedSend } from './dispatch';
import { applyInboundConsent } from './consent-inbound';
import { askOneGrandfathered, startConfirmation } from './consent-send';
import {
  codeMatches,
  isPaidChannel,
  keywordSet,
  PAID_CHANNELS,
  storedDestination,
  type PaidChannel,
} from './consent-text';
import {
  consentStore,
  type CodeResult,
  type ConfirmationResult,
  type ConsentDeps,
  type ConsentView,
  type InboundConsentInput,
  type InboundConsentResult,
  type NotificationConsentConfig,
  type ResolvedConsentConfig,
} from './consent-types';

/**
 * The confirmed-destination engine: may this person's NUMBER be sent
 * a billed message on this channel?
 *
 * Consent belongs to a NUMBER on ONE channel. Confirming WhatsApp never
 * enables SMS; a phone that changed is unconfirmed until confirmed again, even
 * if nobody told the engine (`forgetDestination`), because every check compares
 * the stored number with the one on file. A reply opt-out (the host's words, or
 * the provider's own stop signal) turns off the channel it arrived on for EVERY
 * account holding that number, from any state.
 *
 * How a channel confirms is the host's declaration (`methods`): `REPLY` sends a
 * question the person answers with a confirm keyword (or the reply button);
 * `CODE` sends a 6-digit code typed in the app, for a channel that cannot carry
 * a reply. The words and the copy are the host's too — the package ships none,
 * and refuses to mount without them.
 *
 * The GATE (`allowed`) is applied by the router when the delivery rows are
 * created and by the dispatcher before every send, retries included — so a
 * queued or failed message is never sent after an opt-out. A grandfathered row
 * (a number that was already receiving before consent existed) passes the gate
 * and is asked once (`askGrandfathered`).
 */

export interface NotificationConsentApi {
  /** Both paid channels, as they stand for the number on file. */
  get(userId: string): Promise<Record<PaidChannel, ConsentView>>;
  /** Ask the number on file to confirm (a reply prompt, or a code). */
  request(userId: string, channel: PaidChannel): Promise<ConfirmationResult>;
  /** Ask again — the same cooldown and daily limit as `request`. */
  resend(userId: string, channel: PaidChannel): Promise<ConfirmationResult>;
  /** Check a typed code (the CODE method). */
  confirmCode(userId: string, channel: PaidChannel, code: string): Promise<CodeResult>;
  /** A reply (or a provider stop signal) from a number, on one channel. */
  applyInbound(input: InboundConsentInput): Promise<InboundConsentResult>;
  /** The phone changed: forget every consent but an opt-out. */
  forgetDestination(userId: string): Promise<void>;
  /** Numbers that were receiving before consent existed keep receiving. */
  grandfather(entries: { userId: string; channel: PaidChannel }[]): Promise<{ created: number }>;
  /** Ask each grandfathered number to confirm — once, ever. */
  askGrandfathered(options?: { take?: number }): Promise<{ asked: number }>;
}

/** The engine, plus the things only the mount's own parts call. */
export interface ConsentEngine extends NotificationConsentApi {
  /** The gate: `channels` minus the required ones this number has not consented to. */
  allowed(userId: string, phone: string | null, channels: NotificationChannel[]): Promise<NotificationChannel[]>;
  /** A preferences save turned paid channels on: ask where nothing stands. */
  startTurnedOn(userId: string, channels: readonly PaidChannel[]): Promise<void>;
  /** The provider refused a send for the number itself (see `./dispatch.ts`). */
  rejected(rejection: Omit<NotificationRejectedSend, 'deliveryId'> & { ref: string }): Promise<void>;
}

const DEFAULTS = { resendCooldownMs: 60_000, maxSendsPerDay: 3, codeTtlMs: 10 * 60_000, maxCodeAttempts: 5 };

/** Refuse, at mount, the configurations that would gate with no way through. */
export function resolveConsentConfig(
  config: NotificationConsentConfig | undefined,
  requireConsent: readonly NotificationChannel[],
): ResolvedConsentConfig | null {
  for (const channel of requireConsent) {
    if (!isPaidChannel(channel)) {
      throw new Error(`@12-apps/notifications: requireConsent names ${channel}, which is not a paid channel.`);
    }
    if (!config?.methods[channel]) {
      throw new Error(
        `@12-apps/notifications: requireConsent names ${channel}, but consent.methods gives ${channel} no confirmation method.`,
      );
    }
  }
  if (!config) return null;
  const words = { confirm: keywordSet(config.confirmKeywords), optOut: keywordSet(config.optOutKeywords) };
  if (words.confirm.size === 0 || words.optOut.size === 0) {
    throw new Error(
      '@12-apps/notifications: consent needs the host\'s confirmKeywords and optOutKeywords — the package ships no words.',
    );
  }
  return { ...DEFAULTS, ...config, words };
}

const NONE_VIEW: ConsentView = {
  status: 'NONE',
  method: null,
  destination: null,
  confirmedAt: null,
  optedOutAt: null,
  record: null,
};

/** One row as the person sees it: a row for another number is no consent at all. */
function viewOf(row: ChannelConsentRow | undefined, destination: string | null): ConsentView {
  if (!row) return NONE_VIEW;
  if (row.status !== 'OPTED_OUT' && row.destination !== destination) return NONE_VIEW;
  return {
    status: row.status,
    method: row.method,
    destination: row.destination,
    confirmedAt: row.confirmedAt,
    optedOutAt: row.optedOutAt,
    record:
      row.consentAt === null
        ? null
        : { text: row.consentText, externalId: row.consentExternalId, at: row.consentAt },
  };
}

const passes = (row: ChannelConsentRow, destination: string): boolean =>
  (row.status === 'CONFIRMED' || row.status === 'GRANDFATHERED') && row.destination === destination;

async function checkCode(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  row: ChannelConsentRow,
  code: string,
): Promise<CodeResult> {
  const now = new Date();
  if (row.codeExpiresAt === null || row.codeHash === null) return { status: 'NO_PENDING' };
  if (row.codeExpiresAt <= now) return { status: 'EXPIRED' };
  // The try is SPENT before the code is compared, in one conditional write:
  // twenty parallel guesses spend twenty tries, never twenty first tries.
  const spent = await store.updateMany({
    where: { id: row.id, codeHash: row.codeHash, codeAttempts: { lt: deps.config.maxCodeAttempts } },
    data: { codeAttempts: { increment: 1 } },
  });
  if (spent.count !== 1) return { status: 'TOO_MANY_ATTEMPTS' };
  if (!codeMatches(row.id, code, row.codeHash)) {
    return { status: 'WRONG', attemptsLeft: Math.max(0, deps.config.maxCodeAttempts - row.codeAttempts - 1) };
  }
  const confirmed = await store.updateMany({
    where: { id: row.id, codeHash: row.codeHash, status: { in: ['PENDING', 'GRANDFATHERED'] } },
    data: { status: 'CONFIRMED', method: 'CODE', confirmedAt: now, consentAt: now, codeHash: null, codeExpiresAt: null },
  });
  return confirmed.count === 1 ? { status: 'CONFIRMED' } : { status: 'NO_PENDING' };
}

async function destinationOf(deps: ConsentDeps, userId: string): Promise<string | null> {
  const contact = await deps.contacts.getContact(userId);
  return storedDestination(contact?.phone, deps.config.defaultCountryCode);
}

async function grandfatherRows(
  deps: ConsentDeps,
  entries: readonly { userId: string; channel: PaidChannel }[],
): Promise<{ userId: string; channel: PaidChannel; destination: string }[]> {
  const unique = new Map(entries.map((entry) => [`${entry.userId}\u0000${entry.channel}`, entry]));
  const rows: { userId: string; channel: PaidChannel; destination: string }[] = [];
  for (const entry of unique.values()) {
    const destination = await destinationOf(deps, entry.userId);
    if (destination) rows.push({ ...entry, destination });
  }
  return rows;
}

async function viewsOf(deps: ConsentDeps, userId: string): Promise<Record<PaidChannel, ConsentView>> {
  const [rows, destination] = await Promise.all([
    consentStore(deps).then((store) => store.findMany({ where: { userId } })),
    destinationOf(deps, userId),
  ]);
  return Object.fromEntries(
    PAID_CHANNELS.map((channel) => [channel, viewOf(rows.find((row) => row.channel === channel), destination)]),
  ) as Record<PaidChannel, ConsentView>;
}

async function confirmCodeFor(
  deps: ConsentDeps,
  userId: string,
  channel: PaidChannel,
  code: string,
): Promise<CodeResult> {
  const store = await consentStore(deps);
  const row = await store.findUnique({ where: { userId_channel: { userId, channel } } });
  const destination = await destinationOf(deps, userId);
  const open = row && row.destination === destination && (row.status === 'PENDING' || row.status === 'GRANDFATHERED');
  if (!open || deps.config.methods[channel] !== 'CODE') return { status: 'NO_PENDING' };
  return checkCode(deps, store, row, code);
}

async function grandfatherAll(
  deps: ConsentDeps,
  entries: readonly { userId: string; channel: PaidChannel }[],
): Promise<{ created: number }> {
  const rows = await grandfatherRows(deps, entries);
  if (rows.length === 0) return { created: 0 };
  const store = await consentStore(deps);
  // `skipDuplicates`: an existing row — confirmed, pending, opted out — is
  // never downgraded, and an opt-out is never resurrected.
  const { count } = await store.createMany({
    data: rows.map((row) => ({ ...row, status: 'GRANDFATHERED' as const, method: 'GRANDFATHERED' as const })),
    skipDuplicates: true,
  });
  return { created: count };
}

async function askGrandfatheredRows(deps: ConsentDeps, take: number): Promise<{ asked: number }> {
  const store = await consentStore(deps);
  const rows = await store.findMany({
    where: { status: 'GRANDFATHERED', askedAt: null },
    orderBy: { createdAt: 'asc' },
    take,
  });
  let asked = 0;
  for (const row of rows) {
    if (await askOneGrandfathered(deps, store, row)) asked += 1;
  }
  return { asked };
}

/** The gate: the required channels pass only on a consent for THIS number. */
async function allowedFor(
  deps: ConsentDeps,
  required: ReadonlySet<NotificationChannel>,
  input: { userId: string; phone: string | null; channels: NotificationChannel[] },
): Promise<NotificationChannel[]> {
  const gated = input.channels.filter((channel) => required.has(channel));
  if (gated.length === 0) return input.channels;
  const destination = storedDestination(input.phone, deps.config.defaultCountryCode);
  const rows = destination
    ? await (await consentStore(deps)).findMany({ where: { userId: input.userId, channel: { in: gated } } })
    : [];
  const ok = new Set(rows.filter((row) => destination && passes(row, destination)).map((row) => row.channel));
  return input.channels.filter((channel) => !required.has(channel) || ok.has(channel));
}

/**
 * The provider refused a send because of the number. A BAD number loses its
 * grandfathering (owner, 2026-11-16: a permanent failure on a grandfathered
 * phone stops sends); a confirmed number is not touched, its owner proved it.
 * An OPT-OUT the provider holds (the person replied STOP to the provider's
 * sender) is recorded like a reply opt-out: every account holding the number on
 * that channel, and this account's own row even when it had none or held an
 * older number.
 */
async function recordRejection(
  deps: ConsentDeps,
  input: Omit<NotificationRejectedSend, 'deliveryId'> & { ref: string },
): Promise<void> {
  const { userId, channel } = input;
  if (!isPaidChannel(channel)) return;
  const store = await consentStore(deps);
  if (input.kind === 'BAD_NUMBER') {
    await store.deleteMany({ where: { userId, channel, status: 'GRANDFATHERED' } });
    return;
  }
  const destination = storedDestination(input.phone, deps.config.defaultCountryCode);
  if (!destination) return;
  const at = new Date();
  await applyInboundConsent(deps, { channel, from: destination, optOut: true, at, externalId: input.ref });
  const method = deps.config.methods[channel] ?? 'REPLY';
  await store.createMany({
    data: [{ userId, channel, destination, status: 'OPTED_OUT', method }],
    skipDuplicates: true,
  });
  await store.updateMany({
    where: { userId, channel },
    data: { destination, status: 'OPTED_OUT', optedOutAt: at, codeHash: null, codeExpiresAt: null },
  });
}

/** A save turned paid channels on: ask where nothing stands for the number. */
async function startTurnedOn(deps: ConsentDeps, userId: string, channels: readonly PaidChannel[]): Promise<void> {
  const asking = channels.filter((channel) => deps.config.methods[channel] !== undefined);
  if (asking.length === 0) return;
  const views = await viewsOf(deps, userId);
  for (const channel of asking) {
    const status = views[channel].status;
    if (status !== 'NONE' && status !== 'OPTED_OUT') continue;
    try {
      await startConfirmation(deps, userId, channel, 'REQUEST');
    } catch (error) {
      // The save itself succeeded; a provider error must not undo it.
      deps.logger.error(`[notifications] confirmation request failed for ${userId}:`, error);
    }
  }
}

export function createConsentEngine(deps: ConsentDeps, requireConsent: readonly NotificationChannel[]): ConsentEngine {
  const required = new Set(requireConsent);
  return {
    get: (userId) => viewsOf(deps, userId),
    request: (userId, channel) => startConfirmation(deps, userId, channel, 'REQUEST'),
    resend: (userId, channel) => startConfirmation(deps, userId, channel, 'RESEND'),
    confirmCode: (userId, channel, code) => confirmCodeFor(deps, userId, channel, code),
    applyInbound: (input) => applyInboundConsent(deps, input),
    async forgetDestination(userId) {
      const store = await consentStore(deps);
      // The opt-out stays: it is a record of what the person said, not a consent.
      await store.deleteMany({ where: { userId, status: { in: ['PENDING', 'CONFIRMED', 'GRANDFATHERED'] } } });
    },
    grandfather: (entries) => grandfatherAll(deps, entries),
    askGrandfathered: (options = {}) => askGrandfatheredRows(deps, options.take ?? 100),
    allowed: (userId, phone, channels) => allowedFor(deps, required, { userId, phone, channels }),
    startTurnedOn: (userId, channels) => startTurnedOn(deps, userId, channels),
    rejected: (rejection) => recordRejection(deps, rejection),
  };
}
