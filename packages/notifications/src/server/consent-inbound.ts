import type { ChannelConsentDelegate, ChannelConsentMethod, ChannelConsentRow } from './consent-db';
import { inboundDestination, replyIntent } from './consent-text';
import {
  consentStore,
  type ConsentDeps,
  type InboundConsentInput,
  type InboundConsentResult,
} from './consent-types';

/**
 * A reply from a number, applied to every account holding that number on the
 * channel it arrived on — at most three statements: one read of the
 * (channel, number) rows and one conditional write.
 *
 *  - An OPT-OUT (a host opt-out keyword, or the provider's own stop signal)
 *    moves every row of the number to `OPTED_OUT`, from any state. Only that
 *    channel: a WhatsApp "SAIR" leaves SMS alone.
 *  - A CONFIRM keyword confirms the rows still waiting (`PENDING`) or
 *    grandfathered, keeping the reply as the consent record. Never on a CODE
 *    channel (it has no replies), never a row nobody asked, and never against
 *    an opt-out that happened AFTER the reply was sent: a late SIM older than
 *    the SAIR changes nothing.
 *  - Anything else — "sim, quero", "sair do grupo" — is a sentence, and
 *    IGNORED: only the whole reply, folded, is a keyword.
 */

const IGNORED: InboundConsentResult = { outcome: 'IGNORED', userIds: [] };

/** The accounts among rows: a guest row (`userId: null`) is nobody's account. */
const accountsOf = (rows: readonly { userId: string | null }[]): string[] =>
  rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));

/**
 * The number's GUEST stop: one row per (number, channel) with no account,
 * created opted out (the partial unique index on `(destination, channel)
 * WHERE user_id IS NULL` makes a second one a no-op). It is what stops a
 * `notifyGuest` to a number that holds no account, or whose account rows are
 * for another channel; a number's STOP is honoured whoever it reaches.
 */
export async function stopGuest(
  store: ChannelConsentDelegate,
  input: {
    channel: string;
    destination: string;
    at: Date;
    externalId: string | null;
    method: ChannelConsentMethod;
  },
): Promise<void> {
  await store.createMany({
    data: [
      {
        userId: null,
        channel: input.channel,
        destination: input.destination,
        status: 'OPTED_OUT',
        method: input.method,
        optedOutAt: input.at,
        consentExternalId: input.externalId,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * A STOP from the number: the number's guest row (so a guest send stops too,
 * with or without an account behind it), and every account row on it.
 */
async function optOut(
  deps: ConsentDeps,
  store: ChannelConsentDelegate,
  rows: ChannelConsentRow[],
  input: InboundConsentInput,
  destination: string,
): Promise<InboundConsentResult> {
  await stopGuest(store, {
    channel: input.channel,
    destination,
    at: input.at,
    externalId: input.externalId,
    method: deps.config.methods[input.channel] ?? 'REPLY',
  });
  const targets = rows.filter((row) => row.status !== 'OPTED_OUT');
  if (targets.length === 0) return IGNORED;
  await store.updateMany({
    where: {
      id: { in: targets.map((row) => row.id) },
      status: { in: ['PENDING', 'CONFIRMED', 'GRANDFATHERED'] },
    },
    data: {
      status: 'OPTED_OUT',
      optedOutAt: input.at,
      codeHash: null,
      codeExpiresAt: null,
    },
  });
  return { outcome: 'OPTED_OUT', userIds: accountsOf(targets) };
}

export async function applyInboundConsent(
  deps: ConsentDeps,
  input: InboundConsentInput,
): Promise<InboundConsentResult> {
  const destination = inboundDestination(input.from);
  const intent = replyIntent(input, deps.config.words);
  if (!destination || !intent) return IGNORED;
  if (intent === 'CONFIRM' && deps.config.methods[input.channel] !== 'REPLY') return IGNORED;

  const store = await consentStore(deps);
  const rows = await store.findMany({ where: { channel: input.channel, destination } });

  if (intent === 'OPT_OUT') return optOut(deps, store, rows, input, destination);

  const targets = rows.filter(
    (row) =>
      (row.status === 'PENDING' || row.status === 'GRANDFATHERED') &&
      (row.optedOutAt === null || input.at > row.optedOutAt),
  );
  if (targets.length === 0) return IGNORED;
  const { count } = await store.updateMany({
    where: { id: { in: targets.map((row) => row.id) }, status: { in: ['PENDING', 'GRANDFATHERED'] } },
    data: {
      status: 'CONFIRMED',
      method: 'REPLY',
      confirmedAt: input.at,
      consentText: input.text ?? null,
      consentExternalId: input.externalId,
      consentAt: input.at,
      codeHash: null,
      codeExpiresAt: null,
    },
  });
  return count === 0 ? IGNORED : { outcome: 'CONFIRMED', userIds: accountsOf(targets) };
}
