import { CredentialsError, WebhookVerificationError } from './errors';
import type {
  ChargeStore,
  CredentialStore,
  RetryableAttemptBucket,
  StoredWebhookDelivery,
  WebhookEventHandler,
  WebhookInbox,
} from './ports';
import type { ProviderRegistry } from './registry';
import type { NormalizedWebhookEvent } from './types';
import { ingestWebhookEvents } from './webhook-pipeline';

/**
 * Webhook REPLAY — the sweep that finishes the deliveries nothing else will.
 *
 * The inbox is a transactional inbox: `record()` commits a delivery before any
 * of it is applied. Two failure shapes leave a row behind, and until this
 * module existed nothing we own ever touched either one again:
 *
 *   - FAILED — the handler threw (a database blip while marking the order
 *     paid). Recovery depended entirely on the provider choosing to redeliver.
 *   - PENDING — the process died between `record()` and `markProcessed`.
 *     Strictly worse: the provider already received its 2xx, so as far as it is
 *     concerned we ACCEPTED the delivery and it will never send it again. That
 *     row is the only surviving evidence that a buyer paid.
 *
 * This is the work that marks an order paid, so leaving its recovery to a
 * provider's goodwill is not a policy. The sweep re-runs the pipeline over
 * those rows ourselves.
 *
 * ## Replay re-runs `adapter.webhook.verify`, and must
 *
 * The tempting shortcut is to skip verification here, on the theory that the
 * signature was checked once at intake and a stored body could not pass a
 * timestamp-tolerant scheme a second time anyway. Both halves of that are
 * wrong, and the second is wrong in a way that reads as rigour:
 *
 *   - No scheme in this repo is timestamp-bounded. PagBank hashes
 *     `${token}-${rawBody}`, Stone compares HTTP Basic, the shared-secret
 *     adapters compare a header for equality, and Stripe HMACs `"<t>.<body>"`
 *     with `t` read out of the STORED header and no skew window checked
 *     anywhere. Every one of them reads only bytes `record()` persisted
 *     verbatim, so re-verifying a row stored hours ago succeeds, forever. There
 *     were never any bounded attempts to burn.
 *   - "Verified at intake" is not the same claim as "verified". For InfinitePay
 *     `verify` IS the payment confirmation: deliveries are unsigned, so the
 *     adapter re-asks InfinitePay over the wire (`payment_check`) and `parse`
 *     then hardcodes `status: 'PAID'` on the strength of that call having
 *     happened. Skipping `verify` on this path would have replay assert PAID
 *     with nothing having confirmed it — including hours after the payment was
 *     reversed at the provider, which is precisely the window a stranded row
 *     sits in. A provider redelivery down the live path re-asks and is
 *     rejected; the sweep must hold itself to the same standard.
 *
 * So this path resolves credentials and verifies, exactly as
 * `gateway.handleWebhook` does. A row that will not verify is marked FAILED
 * with its attempt counted, so it retires into the FAILED set for support
 * rather than being re-applied by every pass.
 *
 * What replay still refuses is a BODY from a caller. Its only input is
 * `webhooks.listRetryable()`; the entry point takes no body, no headers and no
 * merchant, so there is no surface here for anyone to hand over bytes that the
 * inbox did not itself record. Verification then decides what happens to them.
 */

/**
 * First retry delay, and the ceiling the doubling stops at.
 *
 * One minute of quiet before the first retry: long enough that a row still
 * being worked by a live delivery is never picked up (a handler runs in
 * milliseconds), short enough that "the order was marked paid" is not a
 * next-morning event. The six-hour ceiling exists so a row that has been
 * failing all day is still retried on a human timescale — an uncapped curve
 * reaches days, at which point the row is abandoned in practice while still
 * looking retryable.
 */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

/** Replay attempts (EXCLUSIVE) past which a row is left FAILED for support. */
const DEFAULT_MAX_ATTEMPTS = 10;
/** Rows one sweep will replay. Bounded so a backlog drains over passes. */
const DEFAULT_LIMIT = 50;

/**
 * How long a row must sit untouched before it is retried again: standard
 * exponential backoff (1m, 2m, 4m, … ) capped at {@link MAX_BACKOFF_MS}.
 *
 * Pure and exported for its own sake — it is the one piece of replay policy
 * worth pinning in a unit test, and every cutoff the sweep sends to the store
 * is derived from it rather than from a second hardcoded constant that could
 * drift from this curve.
 */
export function backoffFor(attempts: number): number {
  // A negative or fractional count is a corrupt row, not a reason to throw:
  // treat it as the first attempt, which is the most conservative reading (it
  // waits the least, and the attempt cap still retires the row).
  const steps = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  // `2 ** steps` overflows to Infinity for absurd counts; the cap absorbs it.
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** steps);
}

/**
 * The whole eligibility rule, as the one value the store can answer exactly:
 * one bucket per replay-attempt count still under the cap, each carrying that
 * count's own cutoff.
 *
 * Enumerating is what keeps the rule in ONE place. The alternative — hand the
 * store the smallest cutoff and re-filter the superset here — needs the backoff
 * curve implemented twice (once as a query, once as a loop) and, worse, lets
 * rows that are merely WAITING occupy the query's `limit`. Since a longer
 * backoff means an older `updatedAt`, and the store returns oldest first, those
 * waiting rows sort ahead of every due row and eat the entire batch: the sweep
 * then attempts nothing, for hours, while looking idle.
 */
function retryableBuckets(now: Date, maxAttempts: number): RetryableAttemptBucket[] {
  const buckets: RetryableAttemptBucket[] = [];
  for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
    buckets.push({ attempts, updatedBefore: new Date(now.getTime() - backoffFor(attempts)) });
  }
  return buckets;
}

export interface WebhookReplayOptions {
  /**
   * The instant the sweep reckons its backoff from. Defaults to now; passing
   * it explicitly is what makes the policy testable without a clock.
   */
  now?: Date;
  /** Attempt cap (exclusive). Past it a row stays FAILED and support-visible. */
  maxAttempts?: number;
  /** Maximum rows replayed in one pass. */
  limit?: number;
}

/** What one sweep did — the numbers a host job logs or alerts on. */
export interface WebhookReplayReport {
  /**
   * Rows replayed. Every listed row is replayed, because the store answers
   * eligibility exactly — so `attempted: 0` means "nothing was due", never
   * "the batch was full of rows I could not touch". That equivalence is what
   * lets the host stay SILENT on a zero pass without hiding a starved sweep.
   */
  attempted: number;
  /** Rows whose events applied and settled on this pass. */
  processed: number;
  /** Rows that failed again — each FAILED with one replay attempt counted. */
  failed: number;
  /** Rows that had settled by the time replay reached them — nothing to do. */
  skipped: number;
  /**
   * Rows in this batch whose stored bytes would not rehydrate into a delivery.
   *
   * Counted separately from `failed` because the cause differs in kind: a
   * failure is the handler saying no and is worth retrying, whereas this row
   * can never be replayed by anyone. It is reported rather than silently
   * dropped — a delivery we cannot reconstruct may be a paid order, and that
   * deserves a human.
   *
   * Deliberately "found", not "retired". The sweep asks for each one to be
   * retired, but the write is guarded on the row still being unsettled and may
   * legitimately do nothing — a live delivery got there first, which is a good
   * outcome, not a retirement. It can also fail outright on a store fault. A
   * count that claimed retirement would be wrong in both cases, so it claims
   * only what it actually observed: this many rows could not be decoded.
   */
  undecodable: number;
}

/** Ports the sweep needs — a structural subset of `PaymentsGatewayConfig`. */
interface WebhookReplayDeps<P extends string> {
  providers: ProviderRegistry<P>;
  /**
   * Needed for `webhook.verify`, which this path runs. Withholding it used to
   * be described as a safety property; it was the opposite — see the module
   * note on what InfinitePay's `verify` actually does.
   */
  credentials: CredentialStore;
  charges: ChargeStore;
  webhooks: WebhookInbox;
  onWebhookEvent?: WebhookEventHandler;
}

export async function replayRetryableWebhooks<P extends string>(
  deps: WebhookReplayDeps<P>,
  options: WebhookReplayOptions = {},
): Promise<WebhookReplayReport> {
  const now = options.now ?? new Date();
  const report: WebhookReplayReport = {
    attempted: 0,
    processed: 0,
    failed: 0,
    skipped: 0,
    undecodable: 0,
  };
  // Exactly the due rows, decided by the store. `limit` therefore buys `limit`
  // units of real work: a backlog bigger than one batch drains over passes,
  // and it converges rather than deadlocking, because each pass moves the rows
  // it touched into a longer backoff and frees their slots for the rest.
  const { deliveries: due, undecodable } = await deps.webhooks.listRetryable({
    buckets: retryableBuckets(now, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    limit: options.limit ?? DEFAULT_LIMIT,
  });

  // Retire the rows that cannot be rehydrated BEFORE replaying, so a batch made
  // entirely of them still makes progress. Each one spent a slot in this batch;
  // charging it a replay attempt moves its `updatedAt` and climbs it toward the
  // cap, so the slot comes back instead of being lost again on every pass. See
  // `RetryableBatch` for the starvation this prevents.
  for (const id of undecodable) {
    report.undecodable += 1;
    try {
      // `markFailed` is guarded on the row still being unsettled, inside the
      // write — see the port. That matters most here, on the one replay path
      // with no `record()` call to re-check settlement at act time, but it is
      // the same guard every failure write gets, because PROCESSED is terminal
      // on all of them.
      await deps.webhooks.markFailed(
        id,
        'stored webhook headers could not be decoded; the delivery cannot be replayed',
        'REPLAY',
      );
    } catch {
      // Same reasoning as the per-row guard below: a failed status write must
      // not end the pass. The row keeps its slot until the next sweep, which is
      // the outcome we already had — never worse.
    }
  }

  for (const row of due) {
    report.attempted += 1;
    try {
      const outcome = await replayOne(deps, row);
      report[outcome] += 1;
    } catch {
      // A row's own bookkeeping is a WRITE to the inbox (`markFailed`, or the
      // ingest's `markProcessed`), and a write to the inbox can fail like any
      // other — a lost connection is exactly the outage that stranded these
      // rows in the first place. Unguarded, one failed status write would end
      // the whole pass and leave every remaining row untouched, which is the
      // precise failure mode a sweep whose purpose is UN-sticking must not
      // have: the next row is very likely another merchant's paid order.
      //
      // Nothing is re-marked here, deliberately: the write is what just threw,
      // so retrying it in its own error handler throws again. The row keeps its
      // status, its attempts and its `updatedAt`, so the next pass simply lists
      // it again — the right direction for a transient store fault, and safe
      // even if the charge did apply before the write failed, since re-applying
      // a snapshot is what `upsertByProviderChargeId` is built to absorb
      // (merchant-scoped and monotonic). It is counted as `failed` because that
      // is what it is: the row did not settle.
      report.failed += 1;
    }
  }
  return report;
}

/**
 * Re-authenticate a stored delivery and turn it back into events.
 *
 * This is the live path's `verify` → `parse` pair, run again over bytes the
 * inbox persisted verbatim. Failure of any step THROWS so `replayOne` has one
 * place to record it: an unregistered provider, a merchant whose credentials
 * are gone, a delivery the provider will no longer confirm, and an unparseable
 * body all mean the same thing here — this row cannot be applied on this pass.
 */
async function verifyAndParse<P extends string>(
  deps: WebhookReplayDeps<P>,
  row: StoredWebhookDelivery,
): Promise<NormalizedWebhookEvent[]> {
  const provider = row.delivery.provider;
  const adapter = deps.providers.get(provider);
  // Listen-only, same as the live path: a stored delivery is about money that
  // already moved, so a provider the owner has since paused (or one still
  // earning its activation) must not have its recorded row retired unapplied.
  const credentials = deps.credentials.getConnectedCredentials
    ? await deps.credentials.getConnectedCredentials(row.merchant, provider)
    : await deps.credentials.getCredentials(row.merchant, provider);
  // No credentials means no way to authenticate the row — a disconnected
  // provider, or one whose secret was rotated away. FAIL CLOSED and let the
  // attempt cap retire it; applying an unauthenticated "paid" would be the one
  // outcome worse than a support ticket.
  if (!credentials) {
    throw new CredentialsError(provider, `Provider ${provider} is no longer connected`);
  }
  if (!(await adapter.webhook.verify(row.delivery, credentials))) {
    throw new WebhookVerificationError(adapter.name);
  }
  return adapter.webhook.parse(row.delivery, credentials);
}

/**
 * Replay one recorded row.
 *
 * It goes back through `ingestWebhookEvents` — the same record → apply →
 * notify → settle sequence the live path runs — instead of shortcutting to the
 * charge update, and re-entering through `record()` is the POINT rather than
 * overhead: `record()` re-reads the row, so a delivery that settled between
 * the listing query and this call hits exactly the `duplicate && settled` skip
 * a provider redelivery would. The "already applied" decision is therefore
 * made at act time, never at list time, which is what closes the
 * read-then-write window against a live delivery landing mid-sweep.
 *
 * Three things stack against a live delivery arriving DURING a sweep, so that
 * both paths can never apply the same charge:
 *
 *   1. Eligibility is backoff-gated on `updatedAt`, and every inbox write
 *      touches `updatedAt`. A row being worked right now was just recorded, so
 *      it is invisible to the sweep until it has sat quiet for at least the
 *      base backoff — a minute, against a handler that runs in milliseconds.
 *      This is also why a live redelivery's own `markFailed` still bumps
 *      `updatedAt` even though it spends none of the replay budget: while the
 *      provider is actively retrying, the sweep should stand back, and it does.
 *   2. The `record()` re-read above: whichever path settles the row first turns
 *      the other into a no-op skip, with no window between the read and the
 *      decision.
 *   3. Anything that still overlaps inside that window is, by construction, a
 *      DUPLICATE DELIVERY — the exact case the pipeline is already built to
 *      absorb. `upsertByProviderChargeId` is merchant-scoped and monotonic
 *      (status only moves forward, see `core/status.ts`), so applying the same
 *      snapshot twice yields the same row, and the host handler receives the
 *      very `(event, charge)` pair a provider redelivery would have handed it.
 *
 * Two concurrent SWEEPS are excluded upstream, by the host scheduling this
 * single-flight.
 */
async function replayOne<P extends string>(
  deps: WebhookReplayDeps<P>,
  row: StoredWebhookDelivery,
): Promise<'processed' | 'failed' | 'skipped'> {
  let events: NormalizedWebhookEvent[];
  try {
    events = await verifyAndParse(deps, row);
  } catch (error) {
    // Nothing was recorded on this pass, so this function owns the bookkeeping:
    // count the replay attempt so a row that can no longer be authenticated or
    // parsed retires instead of being re-read by every sweep forever.
    await deps.webhooks.markFailed(row.id, messageOf(error), 'REPLAY');
    return 'failed';
  }

  const outcome = await ingestWebhookEvents(deps, row.merchant, row.delivery, events, 'REPLAY');
  // A failure ends this ROW, never the sweep: the next row is very likely a
  // different merchant's paid order, and losing it to an unrelated poisoned
  // payload is the exact failure mode the sweep exists to prevent. The row is
  // already FAILED with its attempt counted by the ingest — marking it again
  // here would burn two attempts per pass.
  if (outcome.failure) return 'failed';
  // The row we came for has to be among the parsed events, or nothing in that
  // ingest settled it: its status and its attempt counter both stand still, and
  // every future sweep re-reads it — a row that occupies a slot in the work list
  // forever while looking like progress. It means the stored body no longer
  // yields the event id it was recorded under (an adapter changed how it derives
  // them), so count the attempt here and let the cap retire it into the FAILED
  // set where support can see it.
  if (!events.some((event) => event.eventId === row.eventId)) {
    const detail = `stored body no longer yields event ${row.eventId}`;
    await deps.webhooks.markFailed(row.id, detail, 'REPLAY');
    return 'failed';
  }
  return outcome.processed.length > 0 ? 'processed' : 'skipped';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
