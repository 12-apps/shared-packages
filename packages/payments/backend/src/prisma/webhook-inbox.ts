import { PaymentsError } from '../core/errors';
import type {
  RetryableAttemptBucket,
  RetryableBatch,
  StoredWebhookDelivery,
  WebhookInbox,
} from '../core/ports';
import type { MerchantRef } from '../core/types';

/**
 * Prisma-backed durable webhook inbox (transactional-inbox pattern) over the
 * OWNED `PaymentWebhookEvent` model. Duck-typed like the other stores here:
 * the host passes its generated delegate, so this package never imports a
 * generated client.
 */

interface WebhookRow {
  id: string;
  /** PENDING | PROCESSED | FAILED — only PROCESSED suppresses a redelivery. */
  status: string;
}

/**
 * The columns a REPLAY needs read back. Deliberately the row as stored, not as
 * the port sees it: `headers` is still the JSON TEXT it was written as, and
 * turning it back into a header map is where the only defensive step lives.
 *
 * No `attempts` and no `updatedAt`: the query below decides eligibility
 * outright, so nothing downstream has a reason to re-derive it.
 */
interface StoredWebhookRow {
  id: string;
  merchantKind: string;
  merchantId: string;
  provider: string;
  eventId: string;
  headers: string;
  payload: string;
}

/**
 * The two unsettled states. Both are owed work; PROCESSED is never re-read.
 *
 * These are the only values the column can hold — `payment_webhook_events`
 * carries a CHECK constraint pinning status to PENDING | PROCESSED | FAILED —
 * which is why retries are bounded by the `replay_attempts` counter and not by
 * some fourth "ABANDONED" state: widening that constraint takes a migration and
 * a policy decision this layer has no business making. Past the cap a row
 * simply stops being listed and stays FAILED, still queryable by support.
 */
const UNSETTLED_STATUSES = ['PENDING', 'FAILED'];

export interface WebhookEventDelegate {
  create(args: {
    data: {
      merchantKind: string;
      merchantId: string;
      provider: string;
      eventId: string;
      headers: string;
      payload: string;
    };
  }): Promise<WebhookRow>;
  findUnique(args: {
    where: {
      merchantKind_merchantId_provider_eventId: {
        merchantKind: string;
        merchantId: string;
        provider: string;
        eventId: string;
      };
    };
  }): Promise<WebhookRow | null>;
  update(args: {
    where: { id: string };
    data: {
      status: string;
      processedAt?: Date;
      lastError?: string;
      attempts?: { increment: number };
      replayAttempts?: { increment: number };
    };
  }): Promise<unknown>;
  updateMany(args: {
    /** The status guard rides in the WHERE so the database decides it. */
    where: { id: string; status: { in: string[] } };
    data: {
      status: string;
      lastError: string;
      attempts: { increment: number };
      replayAttempts?: { increment: number };
    };
  }): Promise<{ count: number }>;
  findMany(args: {
    where: {
      status: { in: string[] };
      /**
       * One branch per eligible replay-attempt count. A disjunction, not a
       * range: each count carries its OWN backoff cutoff, which is the whole
       * reason the predicate cannot be two independent column comparisons.
       */
      OR: Array<{ replayAttempts: number; updatedAt: { lte: Date } }>;
    };
    orderBy: { updatedAt: 'asc' };
    take: number;
  }): Promise<StoredWebhookRow[]>;
}

/**
 * Stored headers JSON → the `Record<string, string>` `record()` was handed, or
 * `null` when the column does not hold one.
 *
 * Returns null instead of throwing so the CALLER can drop one bad row rather
 * than lose the batch — see `listRetryable`. Non-string values are dropped
 * pair-by-pair for the same reason: they cannot have come from a
 * `WebhookDelivery`, and one odd pair is no reason to abandon a paid order.
 */
function parseStoredHeaders(raw: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') headers[key] = value;
  }
  return headers;
}

export function createPrismaWebhookInbox(delegate: WebhookEventDelegate): WebhookInbox {
  return {
    async record(merchant, delivery, eventId) {
      const where = {
        merchantKind_merchantId_provider_eventId: {
          merchantKind: merchant.kind,
          merchantId: merchant.id,
          provider: delivery.provider,
          eventId,
        },
      };
      try {
        const row = await delegate.create({
          data: {
            merchantKind: merchant.kind,
            merchantId: merchant.id,
            provider: delivery.provider,
            eventId,
            headers: JSON.stringify(delivery.headers),
            payload: delivery.rawBody,
          },
        });
        return { id: row.id, duplicate: false, settled: false };
      } catch {
        // Unique violation → this delivery was already recorded. Only a row
        // that actually PROCESSED suppresses the retry; one left PENDING or
        // FAILED must be applied on redelivery.
        const existing = await delegate.findUnique({ where });
        if (existing) {
          return { id: existing.id, duplicate: true, settled: existing.status === 'PROCESSED' };
        }
        throw new PaymentsError(
          'WebhookInboxError',
          'webhook inbox insert failed without a duplicate row',
        );
      }
    },
    async markProcessed(id) {
      await delegate.update({
        where: { id },
        data: { status: 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 } },
      });
    },
    async markFailed(id, error, source) {
      // TWO counters, deliberately. `attempts` is every processing attempt from
      // either path — support telemetry, and the honest answer to "how many
      // times has this been tried". `replayAttempts` is the SWEEP's budget, so
      // only a replay may spend it: a provider that redelivers a broken handler
      // every few minutes would otherwise exhaust the cap on the live path and
      // drop the row out of `listRetryable` having never had it replayed once.
      //
      // `updateMany`, not `update`, purely for the WHERE clause: PROCESSED is
      // terminal, and the guard has to be evaluated by the database in the same
      // statement. Every caller awaits something before reaching here — a replay
      // re-verifies over the wire — so a live delivery can settle the row in the
      // meantime, and a read-then-write would only narrow that window. Zero rows
      // updated is success: something else finished the work.
      await delegate.updateMany({
        where: { id, status: { in: UNSETTLED_STATUSES } },
        data: {
          status: 'FAILED',
          lastError: error,
          attempts: { increment: 1 },
          ...(source === 'REPLAY' ? { replayAttempts: { increment: 1 } } : {}),
        },
      });
    },
    listRetryable: (options) => listRetryableRows(delegate, options),
  };
}

async function listRetryableRows(
  delegate: WebhookEventDelegate,
  { buckets, limit }: { buckets: readonly RetryableAttemptBucket[]; limit: number },
): Promise<RetryableBatch> {
  // An empty bucket list means no attempt count is eligible, so the answer is
  // "no rows". Returned here rather than left to the query: Prisma's reading of
  // an empty `OR` is a detail of the client, and a gate on money-adjacent rows
  // should not be the place that finds out it changed. It also saves a round
  // trip on the `maxAttempts: 0` configuration, which is how an operator turns
  // the sweep off.
  if (buckets.length === 0) return { deliveries: [], undecodable: [] };
  const rows = await delegate.findMany({
    where: {
      status: { in: UNSETTLED_STATUSES },
      // The EXACT eligibility test, pushed into the query: a row is due when
      // its replay-attempt count matches a bucket and it has been quiet since
      // that bucket's own cutoff. One branch per count under the cap — the
      // counter is bounded, so the disjunction is small and known.
      //
      // The rejected alternative was a single coarse `updatedAt` cutoff with an
      // in-memory re-filter. It starves: `take` is applied before the re-filter
      // and the ordering is oldest-first, so rows that are merely waiting out a
      // long backoff (a long backoff means an OLD `updatedAt`) fill the batch
      // and the rows that are actually due are never returned.
      OR: buckets.map(({ attempts, updatedBefore }) => ({
        replayAttempts: attempts,
        updatedAt: { lte: updatedBefore },
      })),
    },
    // Oldest first: the row stranded longest belongs to the buyer who has been
    // waiting longest.
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  const deliveries: StoredWebhookDelivery[] = [];
  const undecodable: string[] = [];
  for (const row of rows) {
    const headers = parseStoredHeaders(row.headers);
    // Never throw on a malformed row: that would take the whole batch down —
    // every OTHER money-adjacent delivery in it — and do so permanently, since
    // the ordering is oldest-first and the bad row would head every future
    // sweep. But do not silently pass over it either. `take` is applied by the
    // query, so a dropped row has already SPENT a slot; leaving it otherwise
    // untouched means its `updatedAt` never moves and it spends that same slot
    // on every subsequent pass. With `limit` such rows the batch is entirely
    // unreplayable and the valid deliveries queued behind them are never
    // reached at all.
    //
    // So it is REPORTED and the sweep retires it — the row still ends up FAILED
    // and queryable, which is where a human goes looking, but it also stops
    // occupying work the sweep could have been doing.
    if (!headers) {
      undecodable.push(row.id);
      continue;
    }
    deliveries.push({
      id: row.id,
      merchant: { kind: row.merchantKind as MerchantRef['kind'], id: row.merchantId },
      delivery: { provider: row.provider, rawBody: row.payload, headers },
      eventId: row.eventId,
    });
  }
  return { deliveries, undecodable };
}
