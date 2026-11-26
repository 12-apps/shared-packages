import type { NotificationContent, TransportRecipient } from '../types';

import type { ChannelConsentDelegate, ChannelConsentRow, ChannelConsentUpdateData } from './consent-db';
import { hashCode, newCode, storedDestination, type PaidChannel } from './consent-text';
import {
  consentStore,
  type ConfirmMethod,
  type ConfirmationMessageInput,
  type ConfirmationResult,
  type ConsentDeps,
} from './consent-types';
import { twilioRejectionOf } from './twilio';

/**
 * Sending a confirmation: the first ask, a resend, and the one ask a
 * grandfathered phone gets.
 *
 * Every send takes a SLOT first, with one conditional write whose `where`
 * carries the cooldown and the daily limit — so five parallel taps on
 * "Reenviar" send once, and the database, not a read, decides which. The code
 * of a CODE channel is written by that same statement (as a hash), so a resend
 * replaces the old code atomically with the slot.
 *
 * Every send counts toward the person's daily cap (the caps gate, when one is
 * mounted), taken BEFORE the slot and given back if the slot is lost.
 */

const DAY_MS = 24 * 60 * 60_000;

type Contact = NonNullable<Awaited<ReturnType<ConsentDeps['contacts']['getContact']>>>;

function methodOf(deps: ConsentDeps, channel: PaidChannel): ConfirmMethod {
  const method = deps.config.methods[channel];
  if (!method) throw new Error(`@12-apps/notifications: consent.methods has no method for ${channel}.`);
  return method;
}

/** Why a send is not allowed now, read off the row; `null` = a slot is free. */
function slotRefusal(deps: ConsentDeps, row: ChannelConsentRow, now: Date): ConfirmationResult | null {
  const { maxSendsPerDay, resendCooldownMs } = deps.config;
  const windowOpen =
    row.sendWindowStartedAt !== null && now.getTime() - row.sendWindowStartedAt.getTime() < DAY_MS;
  if (windowOpen && row.sendCount >= maxSendsPerDay) return { status: 'DAILY_LIMIT' };
  if (row.lastSentAt === null) return null;
  const waited = now.getTime() - row.lastSentAt.getTime();
  return waited < resendCooldownMs
    ? { status: 'COOLDOWN', retryAfterMs: resendCooldownMs - waited }
    : null;
}

/** The code fields a send writes with its slot. */
function codeData(deps: ConsentDeps, rowId: string, code: string | null, now: Date): ChannelConsentUpdateData {
  if (code === null) return {};
  return {
    codeHash: hashCode(rowId, code),
    codeExpiresAt: new Date(now.getTime() + deps.config.codeTtlMs),
    codeAttempts: 0,
  };
}

/**
 * Take one send slot. The `where` pins what was read: the last send (so a
 * concurrent send that moved it wins alone), and either the open window's
 * count or the expired/absent window that this send restarts.
 */
async function claimSlot(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  row: ChannelConsentRow,
  extra: ChannelConsentUpdateData,
  now: Date,
): Promise<boolean> {
  const cooldownCutoff = new Date(now.getTime() - deps.config.resendCooldownMs);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const lastSentAt = row.lastSentAt === null ? null : { lte: cooldownCutoff };
  const windowOpen = row.sendWindowStartedAt !== null && row.sendWindowStartedAt > dayAgo;
  const { count } = windowOpen
    ? await store.updateMany({
        where: { id: row.id, lastSentAt, sendWindowStartedAt: { gt: dayAgo }, sendCount: { lt: deps.config.maxSendsPerDay } },
        data: { ...extra, lastSentAt: now, sendCount: { increment: 1 } },
      })
    : await store.updateMany({
        where: { id: row.id, lastSentAt, sendWindowStartedAt: row.sendWindowStartedAt === null ? null : { lte: dayAgo } },
        data: { ...extra, lastSentAt: now, sendWindowStartedAt: now, sendCount: 1 },
      });
  return count === 1;
}

/**
 * The row this ask is about, made to describe the CURRENT number: created when
 * absent, reset to PENDING when it holds another number, an opt-out or another
 * method. A confirmed, grandfathered or already-pending row for this number is
 * kept as it is.
 */
async function rowFor(
  store: ChannelConsentDelegate,
  key: { userId: string; channel: PaidChannel; destination: string; method: ConfirmMethod },
): Promise<ChannelConsentRow | null> {
  const unique = { userId_channel: { userId: key.userId, channel: key.channel } };
  const existing = await store.findUnique({ where: unique });
  if (!existing) {
    await store.createMany({
      data: [{ userId: key.userId, channel: key.channel, destination: key.destination, status: 'PENDING', method: key.method }],
      skipDuplicates: true,
    });
    return store.findUnique({ where: unique });
  }
  const sameNumber = existing.destination === key.destination;
  const keep =
    sameNumber &&
    (existing.status === 'CONFIRMED' ||
      existing.status === 'GRANDFATHERED' ||
      (existing.status === 'PENDING' && existing.method === key.method));
  if (keep) return existing;
  await store.updateMany({
    where: { id: existing.id, status: existing.status },
    data: {
      destination: key.destination,
      status: 'PENDING',
      method: key.method,
      codeHash: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      confirmedAt: null,
      consentText: null,
      consentExternalId: null,
      consentAt: null,
    },
  });
  return store.findUnique({ where: unique });
}

/**
 * Build the host's message and hand it to the channel's transport. The
 * formatted message carries the consent row's id (`confirmation`), which the
 * built-in drivers put on the provider's callback, so this message's receipt
 * is told apart from a notification's (`./receipts.ts`).
 */
async function deliverConfirmation(
  deps: ConsentDeps,
  contact: Contact,
  input: ConfirmationMessageInput & { userId: string; rowId: string },
): Promise<void> {
  const { userId, rowId, ...message } = input;
  const transport = deps.transports.get(input.channel);
  if (!transport) throw new Error(`@12-apps/notifications: no ${input.channel} transport is declared.`);
  const content: NotificationContent = deps.config.message(message);
  // The confirmation's own approved template goes on the FORMATTED message, so
  // only a message this engine builds can name one — never a notification's
  // `data`. A transport whose message is not an object ignores it.
  const template = input.channel === 'WHATSAPP' ? deps.config.whatsAppTemplate?.(message) : null;
  const formatted: unknown = transport.format(content);
  const outgoing =
    typeof formatted === 'object' && formatted !== null
      ? { ...formatted, confirmation: rowId, ...(template ? { template } : {}) }
      : formatted;
  const recipient: TransportRecipient = {
    userId,
    email: contact.email,
    phone: contact.phone,
    clientId: null,
    side: null,
    pushSubscriptionCount: 0,
  };
  await transport.send(outgoing as never, recipient);
}

/** The message input for one send, without the keys an absent value must not carry. */
function messageInput(
  channel: PaidChannel,
  method: ConfirmMethod,
  contact: Contact,
  reason: ConfirmationMessageInput['reason'],
  code: string | null,
): ConfirmationMessageInput {
  return {
    channel,
    method,
    reason,
    firstName: contact.firstName ?? null,
    locale: contact.locale ?? null,
    ...(code !== null ? { code } : {}),
  };
}

/** The person, their number, and the row describing it — or why there is nothing to ask. */
async function target(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  userId: string,
  channel: PaidChannel,
): Promise<{ contact: Contact; row: ChannelConsentRow } | ConfirmationResult> {
  const contact = await deps.contacts.getContact(userId);
  const destination = storedDestination(contact?.phone, deps.config.defaultCountryCode);
  if (!contact || !destination) return { status: 'NO_PHONE' };
  const row = await rowFor(store, { userId, channel, destination, method: methodOf(deps, channel) });
  if (!row) return { status: 'NO_PHONE' };
  if (row.status === 'CONFIRMED') return { status: 'ALREADY_CONFIRMED' };
  return { contact, row };
}

/** A slot lost to a concurrent send: give the cap back, and say why now. */
async function lostSlot(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  row: ChannelConsentRow,
): Promise<ConfirmationResult> {
  // A confirmation is only ever an account's; a guest row is never asked.
  const userId = row.userId ?? '';
  await deps.caps?.refundConfirmation(userId);
  const after = await store.findUnique({ where: { userId_channel: { userId, channel: row.channel } } });
  const refusal = after ? slotRefusal(deps, after, new Date()) : null;
  return refusal ?? { status: 'COOLDOWN', retryAfterMs: deps.config.resendCooldownMs };
}

/** Ask (or ask again) one (user, channel) to confirm the number on file. */
export async function startConfirmation(
  deps: ConsentDeps,
  userId: string,
  channel: PaidChannel,
  reason: 'REQUEST' | 'RESEND',
): Promise<ConfirmationResult> {
  const method = methodOf(deps, channel);
  const store = await consentStore(deps);
  const found = await target(deps, store, userId, channel);
  if ('status' in found) return found;
  const { contact, row } = found;

  const now = new Date();
  const refused = slotRefusal(deps, row, now);
  if (refused) return refused;
  if (deps.caps && !(await deps.caps.admitConfirmation(userId))) return { status: 'CAP' };

  const code = method === 'CODE' ? newCode() : null;
  if (!(await claimSlot(deps, store, row, codeData(deps, row.id, code, now), now))) {
    return lostSlot(deps, store, row);
  }
  await deliverConfirmation(deps, contact, {
    userId,
    rowId: row.id,
    ...messageInput(channel, method, contact, reason, code),
  });
  return { status: 'SENT', retryAfterMs: deps.config.resendCooldownMs };
}

/**
 * Ask one grandfathered row, once ever. The ask is CLAIMED (`askedAt` written
 * where it is still null) before anything is sent, so two overlapping runs ask
 * each row once; a run that cannot send releases its claim for the next one.
 */
export async function askOneGrandfathered(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  row: ChannelConsentRow,
): Promise<boolean> {
  // Only an account is grandfathered; a guest row (only ever OPTED_OUT) is never asked.
  const userId = row.userId;
  if (userId === null) return false;
  const channel = row.channel as PaidChannel;
  const method = methodOf(deps, channel);
  const now = new Date();
  const code = method === 'CODE' ? newCode() : null;
  const claimed = await store.updateMany({
    where: { id: row.id, status: 'GRANDFATHERED', askedAt: null },
    data: { ...codeData(deps, row.id, code, now), askedAt: now, lastSentAt: now, sendWindowStartedAt: now, sendCount: 1 },
  });
  if (claimed.count !== 1) return false;

  const release = (): Promise<{ count: number }> =>
    store.updateMany({ where: { id: row.id }, data: { askedAt: null } });
  const contact = await deps.contacts.getContact(userId);
  // A number that changed since the row was written is not this row's to ask.
  if (!contact || storedDestination(contact.phone, deps.config.defaultCountryCode) !== row.destination) {
    return false;
  }
  if (deps.caps && !(await deps.caps.admitConfirmation(userId))) {
    await release();
    return false;
  }
  try {
    await deliverConfirmation(deps, contact, {
      userId,
      rowId: row.id,
      ...messageInput(channel, method, contact, 'GRANDFATHERED', code),
    });
    return true;
  } catch (error) {
    deps.logger.error(`[notifications] grandfathered ask failed for ${row.userId}:`, error);
    await settleFailedAsk(store, row, error, release);
    return false;
  }
}

/**
 * A grandfathered ask the provider refused. Refused for the NUMBER (a bad
 * number, or a STOP the provider holds: `./twilio.ts`), the grandfathering
 * ends — dropped, or opted out — exactly as a delivery refused for it would
 * end it; any other failure releases the claim for the next run.
 */
async function settleFailedAsk(
  store: ChannelConsentDelegate,
  row: ChannelConsentRow,
  error: unknown,
  release: () => Promise<{ count: number }>,
): Promise<void> {
  const kind = twilioRejectionOf(error);
  if (kind === 'BAD_NUMBER') {
    await store.deleteMany({ where: { id: row.id, status: 'GRANDFATHERED' } });
  } else if (kind === 'OPTED_OUT') {
    await store.updateMany({
      where: { id: row.id, status: 'GRANDFATHERED' },
      data: { status: 'OPTED_OUT', optedOutAt: new Date(), codeHash: null, codeExpiresAt: null },
    });
  } else {
    await release();
  }
}
