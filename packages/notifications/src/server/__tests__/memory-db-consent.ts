/* eslint-disable test-flakiness/no-global-state-mutation, test-flakiness/no-random-data --
   this file IS part of the unit suites' database: rows are mutable storage by
   design, and `new Date()` stamps rows the way a column default does. */
import type {
  ChannelConsentDelegate,
  ChannelConsentRow,
  ChannelConsentUpdateData,
  ChannelConsentWhere,
  SendCounterDelegate,
  SendCounterKey,
} from '../consent-db';

/**
 * The two FUT-285 models of the in-memory database (`./memory-db.ts`).
 *
 * Every write evaluates its `where` and applies its `data` with no `await` in
 * between, exactly as one SQL statement does — which is what lets the unit
 * suites pin "five parallel taps send once" and "N parallel emits at cap-1 pass
 * once" here before the harness pins them on Postgres.
 */

export interface SendCounterRow extends SendCounterKey {
  count: number;
  notifiedAt: Date | null;
}

const snapshot = <T extends object>(row: T): T => ({ ...row });

/** `null` or a bound, as a nullable timestamp column compares. */
function timeMatches(
  value: Date | null,
  where: null | { lte: Date } | { gt: Date } | undefined,
): boolean {
  if (where === undefined) return true;
  if (where === null) return value === null;
  if (value === null) return false;
  return 'lte' in where ? value <= where.lte : value > where.gt;
}

function oneOf<T>(value: T, where: T | { in: T[] } | undefined): boolean {
  if (where === undefined) return true;
  if (typeof where === 'object' && where !== null && 'in' in where) return where.in.includes(value);
  return value === where;
}

function consentMatches(row: ChannelConsentRow, where: ChannelConsentWhere): boolean {
  return (
    oneOf(row.id, where.id) &&
    (where.userId === undefined || row.userId === where.userId) &&
    oneOf(row.channel, where.channel) &&
    (where.destination === undefined || row.destination === where.destination) &&
    oneOf(row.status, where.status) &&
    (where.codeHash === undefined || row.codeHash === where.codeHash) &&
    (where.codeAttempts === undefined || row.codeAttempts < where.codeAttempts.lt) &&
    (where.sendCount === undefined || row.sendCount < where.sendCount.lt) &&
    timeMatches(row.lastSentAt, where.lastSentAt) &&
    timeMatches(row.sendWindowStartedAt, where.sendWindowStartedAt) &&
    (where.askedAt === undefined || row.askedAt === null)
  );
}

function applyConsent(row: ChannelConsentRow, data: ChannelConsentUpdateData): void {
  const { codeAttempts, sendCount, ...rest } = data;
  Object.assign(row, rest, { updatedAt: new Date() });
  if (codeAttempts !== undefined) {
    row.codeAttempts = typeof codeAttempts === 'number' ? codeAttempts : row.codeAttempts + codeAttempts.increment;
  }
  if (sendCount !== undefined) {
    row.sendCount = typeof sendCount === 'number' ? sendCount : row.sendCount + sendCount.increment;
  }
}

export function memoryConsentDelegate(
  consents: ChannelConsentRow[],
  nextId: (prefix: string) => string,
): ChannelConsentDelegate {
  return {
    findUnique({ where }) {
      const { userId, channel } = where.userId_channel;
      const row = consents.find((entry) => entry.userId === userId && entry.channel === channel);
      return Promise.resolve(row ? snapshot(row) : null);
    },
    findMany({ where, orderBy, take }) {
      const matched = consents.filter((row) => consentMatches(row, where));
      if (orderBy) matched.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const page = take === undefined ? matched : matched.slice(0, take);
      return Promise.resolve(page.map(snapshot));
    },
    createMany({ data }) {
      let count = 0;
      for (const entry of data) {
        // The two unique keys: an account's (user_id, channel), and a GUEST's
        // (destination, channel) WHERE user_id IS NULL (a partial index).
        const clash = consents.some((row) =>
          entry.userId === null
            ? row.userId === null && row.destination === entry.destination && row.channel === entry.channel
            : row.userId === entry.userId && row.channel === entry.channel,
        );
        if (clash) continue;
        const now = new Date();
        consents.push({
          id: nextId('c'),
          codeHash: null,
          codeExpiresAt: null,
          codeAttempts: 0,
          sendCount: 0,
          sendWindowStartedAt: null,
          lastSentAt: null,
          confirmedAt: null,
          optedOutAt: null,
          consentText: null,
          consentExternalId: null,
          consentAt: null,
          askedAt: null,
          createdAt: now,
          updatedAt: now,
          ...entry,
        });
        count += 1;
      }
      return Promise.resolve({ count });
    },
    updateMany({ where, data }) {
      const matched = consents.filter((row) => consentMatches(row, where));
      for (const row of matched) applyConsent(row, data);
      return Promise.resolve({ count: matched.length });
    },
    deleteMany({ where }) {
      const keep = consents.filter((row) => !consentMatches(row, where));
      const count = consents.length - keep.length;
      consents.splice(0, consents.length, ...keep);
      return Promise.resolve({ count });
    },
  };
}

const sameKey = (row: SendCounterKey, key: SendCounterKey): boolean =>
  row.scope === key.scope && row.subjectId === key.subjectId && row.period === key.period;

export function memoryCounterDelegate(counters: SendCounterRow[]): SendCounterDelegate {
  return {
    createMany({ data }) {
      let count = 0;
      for (const key of data) {
        if (counters.some((row) => sameKey(row, key))) continue;
        counters.push({ ...key, count: 0, notifiedAt: null });
        count += 1;
      }
      return Promise.resolve({ count });
    },
    updateMany({ where, data }) {
      const matched = counters.filter((row) => {
        if (!sameKey(row, where)) return false;
        if (where.notifiedAt === null && row.notifiedAt !== null) return false;
        if (where.count && 'lt' in where.count) return row.count < where.count.lt;
        if (where.count && 'gt' in where.count) return row.count > where.count.gt;
        return true;
      });
      for (const row of matched) {
        if (data.count && 'increment' in data.count) row.count += data.count.increment;
        if (data.count && 'decrement' in data.count) row.count -= data.count.decrement;
        if (data.notifiedAt) row.notifiedAt = data.notifiedAt;
      }
      return Promise.resolve({ count: matched.length });
    },
  };
}
