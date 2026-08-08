import type { AttemptOutcome, FailureBucket, ProbeResult } from './failover';
import type {
  ChargeSnapshot,
  MerchantRef,
  NormalizedWebhookEvent,
  ProviderName,
  WebhookDelivery,
} from './types';

/**
 * Storage ports — the hexagonal boundary that keeps this package
 * database-free. Each host wires its own implementations (Prisma in this
 * repo, anything elsewhere); `memory.ts` ships in-memory versions for tests
 * and hosts that have no database yet. Mirrors the `EntitlementSource` port
 * style of `@12-apps/entitlements`.
 */

// The credential-resolution port lives in `./credential-store.ts` since the
// FUT-678 listening read pushed this file past its size gate — re-exported
// because `core/ports.ts` is the one door every storage port has ever come
// through (same split as `charge-queries.ts` below).
export type { CredentialStore } from './credential-store';

/** A charge row as the host persists it. */
export interface StoredCharge {
  id: string;
  merchant: MerchantRef;
  provider: ProviderName;
  providerChargeId: string;
  /** Host-side reference (order id, invoice id, ...). */
  reference: string;
  /**
   * The key this row is STORED under — null for a charge raised without one.
   *
   * Surfaced because `create` is insert-or-return-EXISTING on two different
   * constraints, and the second one can hand back a row that was never stored
   * under the key the caller just passed: a provider with native
   * reference-based idempotency answers a fresh key with a charge it already
   * created, `(provider, providerChargeId)` collides, and the store returns
   * that earlier row. Without this field the caller cannot tell that charge
   * apart from the one it asked for — it carries the earlier attempt's amount
   * and, for PIX, the earlier attempt's QR.
   *
   * `reference` and this key are therefore the two identity facts a caller
   * must check before writing any bookkeeping from `snapshot`; the snapshot
   * itself carries neither.
   */
  idempotencyKey: string | null;
  snapshot: ChargeSnapshot;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Charge persistence. The contract encodes the idempotency rules the
 * existing PagBank flow proved out at the DB level:
 *
 *   - `(provider, providerChargeId)` is UNIQUE — `upsertByProviderChargeId`
 *     must be insert-or-update, never check-then-insert, so a duplicate
 *     webhook delivery collapses at the storage layer, not in racy app code.
 *   - `(merchant, idempotencyKey)` is UNIQUE, and `create` must be atomic
 *     insert-or-return-existing on it — the DB constraint, not app code, is
 *     what closes the concurrent-retry window. The key is SCOPED TO ONE
 *     MERCHANT: two merchants using the same key string are unrelated
 *     charges, and a lookup must never cross that boundary. Composite keys
 *     must be encoded unambiguously (tuple/multi-column, never delimiter
 *     concatenation of unrestricted strings).
 *
 *     Cross-INSTANCE races (two gateway processes, same key) are closed by
 *     this constraint at the ROW level — at most one stored charge — plus
 *     the key being forwarded to providers with native idempotency, so the
 *     provider also dedups. For a provider without native idempotency the
 *     losing call's charge is never persisted or referenced and expires
 *     unpaid; hosts wanting a hard pre-provider guarantee can additionally
 *     reserve the key (insert a pending row) before invoking the gateway.
 *   - Charge identity never crosses merchants: `create` must THROW (not
 *     return the row) if `(provider, providerChargeId)` already exists under
 *     a DIFFERENT merchant, and `upsertByProviderChargeId` only updates rows
 *     the given merchant owns — a verified-but-misattributed webhook must
 *     not read or mutate another merchant's charge.
 */
export interface ChargeStore {
  findByProviderChargeId(provider: ProviderName, providerChargeId: string): Promise<StoredCharge | null>;
  /** Scoped lookup — only ever returns a charge belonging to `merchant`. */
  findByIdempotencyKey(merchant: MerchantRef, key: string): Promise<StoredCharge | null>;
  create(input: {
    merchant: MerchantRef;
    reference: string;
    snapshot: ChargeSnapshot;
    idempotencyKey?: string;
  }): Promise<StoredCharge>;
  /**
   * Apply a fresher snapshot (from a webhook or a poll) to the stored
   * charge, scoped to the owning merchant — a charge owned by a different
   * merchant is left untouched and `null` is returned. Implementations
   * ignore stale regressions (e.g. a late PENDING arriving after PAID) —
   * status only moves forward.
   */
  upsertByProviderChargeId(merchant: MerchantRef, snapshot: ChargeSnapshot): Promise<StoredCharge | null>;
}

// The CHECKOUT-side charge reads (FUT-740) live in `./charge-queries.ts` so this
// file stays inside its size gate; re-exported because `core/ports.ts` is the one
// door every storage port has ever come through.
export type { ChargeQueryStore, PayableChargeQuery } from './charge-queries';

/**
 * A recorded delivery read back OUT of the inbox — everything a REPLAY needs
 * to re-run the pipeline over it, and nothing else.
 *
 * The raw body, headers and provider come back as the one `WebhookDelivery`
 * value `record()` was handed, rather than as three loose fields: replay feeds
 * it straight back into the pipeline, and a shape that cannot drift from the
 * recorded one is a shape that cannot replay a body against the wrong
 * provider's adapter.
 *
 * Note what is NOT here: `attempts` and `updatedAt`. `listRetryable` answers
 * eligibility EXACTLY (see below), so a caller has no business re-deciding it,
 * and the surest way to stop a second, drifting copy of the backoff rule
 * appearing in the sweep is to withhold the columns it would be computed from.
 * A row's signature is not here either, and cannot be: replay RE-VERIFIES the
 * stored delivery against the merchant's credentials exactly as the live path
 * does, so the bytes it needs are the ones `record()` was handed and nothing
 * about "this was already trusted once" is carried forward.
 */
export interface StoredWebhookDelivery {
  /** Inbox row id — the handle `markProcessed`/`markFailed` take. */
  id: string;
  merchant: MerchantRef;
  /** Rehydrated verbatim: `provider`, `rawBody`, and the lower-cased headers. */
  delivery: WebhookDelivery;
  /** The normalized event id this row was recorded under. */
  eventId: string;
}

/**
 * WHICH path made a processing attempt, and therefore whose budget it spends.
 *
 * The two paths are bounded by completely different things, and conflating them
 * disables the sweep exactly when it is needed most. A LIVE attempt is bounded
 * by the provider's own redelivery policy — outside our control, and for a
 * broken handler that means one attempt every few minutes for hours. A REPLAY
 * attempt is bounded by `listRetryable`'s cap, which is the sweep's entire
 * retry budget. If a live redelivery spent that budget, a row whose provider
 * retried hardest would burn all ten attempts on the live path and drop out of
 * the work list having never been replayed once — the feature switching itself
 * off for its worst cases, silently, because a row that is not listed moves no
 * counter.
 */
export type WebhookAttemptSource = 'LIVE' | 'REPLAY';

/**
 * One page of retryable work: the rows the sweep can act on, plus the rows it
 * must RETIRE without acting on.
 *
 * `undecodable` exists because skipping is not a neutral act here. A row whose
 * stored headers will not parse can never be rehydrated into a delivery, but
 * simply passing over it leaves its `updatedAt` untouched — and the ordering
 * is oldest-first, so an unreplayable row keeps the slot it can never use, on
 * this pass and on every pass after it. Enough of them and the batch is
 * entirely rows that cannot move while the valid deliveries behind them are
 * never reached: an order paid at the provider stays pending forever, which is
 * the exact outcome this sweep exists to prevent.
 *
 * So the store REPORTS them and the sweep retires them — `markFailed` charged
 * to the replay budget, which moves `updatedAt`, climbs the row toward the cap
 * and frees the slot. The split is deliberate: reading decides what is due,
 * the sweep decides what to write.
 */
export interface RetryableBatch {
  /** Rows that rehydrated cleanly and are ready to replay. */
  deliveries: StoredWebhookDelivery[];
  /** Ids of rows whose stored bytes cannot be turned back into a delivery. */
  undecodable: readonly string[];
}

/**
 * One attempt-count bucket of the retry-eligibility test: a row that has made
 * exactly `attempts` REPLAY attempts is due again once it has been untouched
 * since `updatedBefore`.
 *
 * Eligibility is enumerated as buckets rather than handed over as one cutoff
 * because the real test is per-row — `updatedAt <= now - backoffFor(attempts)`
 * — and a query given only the SMALLEST backoff as a single coarse cutoff
 * returns a superset that the caller would have to re-filter. That shape
 * STARVES the sweep, which is why it is not used: the query is bounded by
 * `limit` and ordered oldest-`updatedAt`-first, and a long backoff IS an old
 * `updatedAt`, so the rows still waiting sort to the head of the batch and
 * consume the whole bound. Rows that are genuinely due sit behind them and are
 * never returned — for as long as the waiting ones keep waiting, which at the
 * six-hour cap is hours, with the sweep reporting that it attempted nothing.
 *
 * Enumeration is possible because the attempt counter is bounded by the cap: a
 * small, known set of counts, each with a cutoff computed in JS. The store can
 * therefore answer EXACTLY — typed Prisma only, no raw SQL (docs/SECURITY.md)
 * — and `limit` bounds rows the sweep can ACT on instead of rows it merely
 * looked at.
 */
export interface RetryableAttemptBucket {
  /** Replay attempts made so far. Matched exactly, never as a range. */
  attempts: number;
  /** This bucket's cutoff: a row untouched since here is due. */
  updatedBefore: Date;
}

/**
 * Durable webhook inbox (transactional-inbox pattern, same as the existing
 * `WebhookEvent` table): persist first, process off the response path,
 * dedup on the FULL `(merchant, provider, eventId)` triple — event ids are
 * only unique within one provider account, so a bare-`eventId` key would
 * let one merchant's delivery silently swallow another's.
 */
export interface WebhookInbox {
  /**
   * Record a delivery.
   *
   * `duplicate: true` means this `(merchant, provider, eventId)` was already
   * seen. `settled` says whether that earlier attempt actually SUCCEEDED —
   * and the distinction matters: a delivery whose handler failed (a DB blip
   * while marking the order paid) must stay retryable, or the provider's
   * redelivery — the only automatic recovery there is — would be silently
   * swallowed and the charge would never be applied.
   *
   * Implementations report `settled: false` for a recorded-but-unprocessed
   * row; a first sighting is `{ duplicate: false, settled: false }`.
   */
  record(
    merchant: MerchantRef,
    delivery: WebhookDelivery,
    eventId: string,
  ): Promise<{ id: string; duplicate: boolean; settled: boolean }>;
  markProcessed(id: string): Promise<void>;
  /**
   * Record a failed attempt, and charge it to the right budget.
   *
   * A `'REPLAY'` attempt MUST increment the counter `listRetryable`'s buckets
   * match on — that counter is the entire retry bound, so an implementation
   * that only wrote the error message would leave a permanently poisoned row
   * eligible forever. A `'LIVE'` attempt MUST NOT touch it; see
   * {@link WebhookAttemptSource} for why the two cannot share one budget.
   *
   * PROCESSED IS TERMINAL, and implementations MUST enforce that: this may only
   * move a row that is still unsettled. Nothing should ever walk an applied
   * event back to FAILED, and the reason is not tidiness — `record()` reports
   * `settled` from this very column, so a PROCESSED row dragged to FAILED reads
   * as unsettled to the NEXT provider redelivery, which then re-runs the handler
   * on a charge that already applied.
   *
   * The window is real on every caller that awaits anything before writing. A
   * replay resolves credentials and re-verifies over the wire — for an unsigned
   * provider that is a live call back to the provider — and a live delivery can
   * settle the row during it. `record()`'s act-time re-read covers the paths
   * that go through it; this guard covers the ones that do not.
   *
   * It has to be part of the WRITE — `WHERE id = ? AND status <> 'PROCESSED'`,
   * decided by the database — because a read-then-write only narrows the window,
   * and this is a money path. A no-op is success, not failure: something else
   * finished the work, which is what was wanted.
   */
  markFailed(id: string, error: string, source: WebhookAttemptSource): Promise<void>;
  /**
   * Deliveries the inbox still owes work AND that are DUE right now: recorded
   * but not PROCESSED, and matching one of `buckets` on both its replay-attempt
   * count and its quiet-since cutoff. Oldest `updatedAt` first, at most `limit`
   * rows.
   *
   * Both unsettled states come back, for different reasons: FAILED is a
   * handler that threw, PENDING is a process that died between `record()` and
   * `markProcessed`. PENDING is the worse of the two — the provider already
   * got its 2xx and will never redeliver, so that row is the only surviving
   * evidence that a buyer paid.
   *
   * A PROCESSED row is NEVER returned: replay exists to finish work, never to
   * re-apply it.
   *
   * The bucket list carries the attempt CAP as well as the backoff curve: it
   * enumerates every replay count still under the cap, so a row that has burned
   * the cap matches nothing and stops being listed (it stays FAILED, with its
   * `lastError`, where support can find it). An EMPTY list consequently means
   * "no attempt count is eligible" and MUST return no rows — never everything.
   *
   * Every returned row is eligible, with no second filter owed by the caller.
   * That is a contract, not an implementation detail: see
   * {@link RetryableAttemptBucket} for the starvation an approximate answer
   * causes.
   *
   * A row counted against `limit` that cannot be rehydrated comes back under
   * `undecodable` rather than being dropped, so the sweep can retire it and
   * free the slot — see {@link RetryableBatch}. Dropping it silently starves
   * the batch in the same way an approximate eligibility answer does.
   */
  listRetryable(options: {
    buckets: readonly RetryableAttemptBucket[];
    limit: number;
  }): Promise<RetryableBatch>;
}

/** One recorded step of a failover walk. */
export interface ChargeAttemptRecord {
  merchant: MerchantRef;
  /** Null for charges raised without a key — audited, but not resumable. */
  idempotencyKey?: string | null;
  reference: string;
  provider: ProviderName;
  /** 1-based position within THIS walk. */
  attemptNo: number;
  outcome: AttemptOutcome;
  failureBucket?: FailureBucket | null;
  probeResult?: ProbeResult | null;
  providerChargeId?: string | null;
  error?: string | null;
}

/**
 * The failover audit trail — and, for keyed charges, a load-bearing input
 * rather than mere observability.
 *
 * A retried charge reads its own prior attempts and RESUMES after them. That
 * matters most in the case the whole design is built around: a walk that
 * stopped on an ambiguous failure must not, on retry, cheerfully re-attempt
 * the provider that may already hold the buyer's money. Without a durable
 * record of what was tried, every retry restarts at the top of the chain.
 */
export interface AttemptLedger {
  record(attempt: ChargeAttemptRecord): Promise<void>;
  /** Prior attempts for one (merchant, idempotencyKey), oldest first. */
  listByIdempotencyKey(merchant: MerchantRef, key: string): Promise<ChargeAttemptRecord[]>;
}

/**
 * Host hook invoked with each normalized event AFTER storage is updated —
 * where "mark the order paid", notifications, and rollups live. Kept out of
 * the core so the library stays domain-free.
 *
 * `charge` is null whenever the event names something the gateway never
 * persisted, which is NOT always a stray delivery: the activation charge
 * (FUT-463) is raised through the adapter directly and has no order behind it,
 * so its confirmation arrives here with nothing attached.
 *
 * `merchant` is therefore passed too, and it is the trustworthy half. It is the
 * store the delivery was VERIFIED against — resolved from the URL and the
 * credential store before the signature was checked — never anything the
 * payload claimed. A host that reads an identifier out of the event body must
 * check it against this, or it has let an anonymous caller name a merchant.
 */
export type WebhookEventHandler = (
  event: NormalizedWebhookEvent,
  charge: StoredCharge | null,
  merchant: MerchantRef,
) => Promise<void>;
