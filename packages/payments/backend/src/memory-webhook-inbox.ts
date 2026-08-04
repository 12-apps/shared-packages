import type {
  RetryableAttemptBucket,
  StoredWebhookDelivery,
  WebhookAttemptSource,
  WebhookInbox,
} from './core/ports';
import type { MerchantRef, WebhookDelivery } from './core/types';
import { scopedKey } from './memory-keys';

/**
 * The in-memory webhook inbox — the fake the replay sweep is tested against.
 *
 * Its own module rather than another block in `memory.ts` because it is the one
 * fake with real POLICY in it: `listRetryable` has to answer the same
 * eligibility question `prisma/webhook-inbox.ts` pushes into SQL, and a sweep
 * tested against a looser fake is a sweep nobody has actually checked.
 */

type WebhookRowStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

/**
 * A full inbox row, not just its status — which is all the dedup rules needed.
 * `listRetryable` has to answer from the same facts the real table holds (who
 * it was for, the stored body, attempts, when it last moved) or the replay
 * sweep would be tested against a fiction.
 */
interface MemoryWebhookRow {
  id: string;
  merchant: MerchantRef;
  delivery: WebhookDelivery;
  eventId: string;
  status: WebhookRowStatus;
  /** Every processing attempt, from either path. Telemetry only. */
  attempts: number;
  /** Attempts made by the SWEEP. The only counter that bounds replay. */
  replayAttempts: number;
  updatedAt: Date;
}

/**
 * The predicate the real store pushes into SQL: unsettled, matching one
 * attempt-count bucket on both that bucket's count and its cutoff, oldest
 * first, bounded. One function, so the fake and `prisma/webhook-inbox.ts`
 * cannot drift on what "retryable" means — a sweep tested against a looser fake
 * is a sweep nobody has actually checked. In particular the `slice` happens
 * AFTER the filter here exactly as `take` applies to the filtered rows there,
 * so the fake cannot hide the batch-starvation this shape exists to prevent.
 */
function selectRetryableRows(
  rows: readonly MemoryWebhookRow[],
  options: { buckets: readonly RetryableAttemptBucket[]; limit: number },
): StoredWebhookDelivery[] {
  // Bucket lookup by exact count, mirroring the disjunction the query builds. A
  // row whose count matches nothing is not due, which is also how the attempt
  // cap is enforced — there simply is no bucket past it.
  const dueAt = new Map(options.buckets.map((bucket) => [bucket.attempts, bucket.updatedBefore]));
  return rows
    .filter((row) => {
      if (row.status === 'PROCESSED') return false;
      const cutoff = dueAt.get(row.replayAttempts);
      return cutoff !== undefined && row.updatedAt.getTime() <= cutoff.getTime();
    })
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .slice(0, options.limit)
    .map((row) => ({
      id: row.id,
      merchant: row.merchant,
      delivery: row.delivery,
      eventId: row.eventId,
    }));
}

export interface MemoryWebhookInbox extends WebhookInbox {
  statuses(): Record<string, WebhookRowStatus>;
  /** Every processing attempt by row id, live and replay together. */
  attemptsById(): Record<string, number>;
  /** Replay attempts by row id — the retry bound, as the sweep sees it. */
  replayAttemptsById(): Record<string, number>;
  /**
   * Move a row's backoff clock into the past — the one thing a test cannot do
   * through the port, since `updatedAt` belongs to the store (`@updatedAt` in
   * the real schema). Without it every fixture row is freshly touched and no
   * sweep would ever consider it.
   */
  backdate(id: string, updatedAt: Date): void;
  clear(): void;
}

/**
 * Settle a row, the way the real store's `update` does.
 *
 * Mirrors `@updatedAt`: every state change restarts the backoff clock, which is
 * what keeps a row that is being worked right now out of the sweep's reach.
 * `source` is what decides whether the SWEEP's budget was spent — a live
 * redelivery moves the clock but must not move that counter, or the provider's
 * own retrying would retire the row before the sweep ever reached it.
 */
function touchRow(
  rows: Map<string, MemoryWebhookRow>,
  id: string,
  status: WebhookRowStatus,
  source: WebhookAttemptSource,
): void {
  const row = rows.get(id);
  if (!row) return;
  row.status = status;
  row.attempts += 1;
  if (source === 'REPLAY') row.replayAttempts += 1;
  row.updatedAt = new Date();
}

export function createMemoryWebhookInbox(): MemoryWebhookInbox {
  const byEventId = new Map<string, string>();
  const rows = new Map<string, MemoryWebhookRow>();
  let seq = 0;

  return {
    async record(merchant, delivery, eventId) {
      // Dedup on the full (merchant, provider, eventId) triple — event ids
      // are only unique within one provider account.
      const dedupKey = scopedKey(merchant, delivery.provider, eventId);
      const existing = byEventId.get(dedupKey);
      // A redelivery of an event whose handler FAILED stays retryable. Note the
      // settled flag is read from the row NOW, so a replay that lists a row and
      // then re-records it sees any status change that happened in between.
      if (existing) {
        return {
          id: existing,
          duplicate: true,
          settled: rows.get(existing)?.status === 'PROCESSED',
        };
      }
      seq += 1;
      const id = `whk_${seq}`;
      byEventId.set(dedupKey, id);
      rows.set(id, {
        id,
        merchant,
        delivery,
        eventId,
        status: 'PENDING',
        attempts: 0,
        replayAttempts: 0,
        updatedAt: new Date(),
      });
      return { id, duplicate: false, settled: false };
    },
    async markProcessed(id) {
      // A settled row is never listed again, so which path settled it buys
      // nothing: only the total is worth counting.
      touchRow(rows, id, 'PROCESSED', 'LIVE');
    },
    async markFailed(id, _error, source) {
      // The same guard the real store puts in its WHERE clause: PROCESSED is
      // terminal. A fake that let a failure overwrite it would make the sweep
      // look correct against a store more permissive than the one it runs on.
      if (rows.get(id)?.status === 'PROCESSED') return;
      // Counts the attempt, like the real store — the retry cap depends on it.
      touchRow(rows, id, 'FAILED', source);
    },
    async listRetryable(options) {
      // `undecodable` is always empty here, and that is a property of the fake
      // rather than a shortcut: this store holds header MAPS, so it has no way
      // to represent the malformed JSON TEXT only a real column can contain.
      // The retiring behaviour it triggers is therefore covered against the
      // Prisma adapter and the sweep directly, not through this fake.
      return { deliveries: selectRetryableRows([...rows.values()], options), undecodable: [] };
    },
    statuses() {
      return Object.fromEntries([...rows.values()].map((row) => [row.id, row.status]));
    },
    attemptsById() {
      return Object.fromEntries([...rows.values()].map((row) => [row.id, row.attempts]));
    },
    replayAttemptsById() {
      return Object.fromEntries([...rows.values()].map((row) => [row.id, row.replayAttempts]));
    },
    backdate(id, updatedAt) {
      const row = rows.get(id);
      if (row) row.updatedAt = updatedAt;
    },
    clear() {
      byEventId.clear();
      rows.clear();
      seq = 0;
    },
  };
}
