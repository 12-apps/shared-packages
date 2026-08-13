import { getRealtimeDriver, publishRealtimeEvent } from "../core/runtime";
import type { RealtimeLogger } from "../core/types";

/**
 * The outbox DRAIN — the claim protocol and one pass over it (12-16).
 *
 * Split from `./outbox.ts`, which owns the enqueue side, the constants and the factory. The
 * seam is the one the module already had: writing a row happens inside a HOST's transaction
 * and needs nothing from here, while everything below is about taking exclusive ownership of
 * a row and putting it on the bus.
 *
 * ## Why the whole protocol is conditional `updateMany`s
 *
 * A CLAIM is one statement whose predicate and mutation cannot interleave with another's, so
 * the database decides which of two racing drains wins and `count` is the only signal worth
 * trusting. A drain that read `claimed_at IS NULL` and then wrote would have both drains
 * publish the row — the bug class this shape exists to make unrepresentable — and it is why
 * the db seam below has no `update`, no `findUnique` and no `$transaction` to model.
 */

/** One stored outbox row, as the drain reads it. */
export interface RealtimeOutboxRow {
  id: string;
  topic: string;
  type: string;
  data: unknown;
  attempts: number;
}

/** A claim predicate: never claimed, or claimed so long ago the lease lapsed. */
type ClaimableWhere = [{ claimedAt: null }, { claimedAt: { lt: Date } }];

/**
 * The client slice the drain needs — closed shapes, so a SQL adapter is small
 * and a mismatch is a type error rather than a silently ignored clause.
 *
 * Note what is NOT here: no `update`, no `findUnique`, no `$transaction`. The
 * whole protocol is expressible as conditional `updateMany`s, which is what makes
 * it safe under concurrency without a lock the seam would have to model.
 */
export interface RealtimeOutboxDrainDb {
  realtimeOutboxEvent: {
    /** Candidates: unpublished, under the attempt ceiling, unclaimed or stale. */
    findMany(args: {
      where: {
        publishedAt: null;
        attempts: { lt: number };
        OR: ClaimableWhere;
      };
      orderBy: { createdAt: "asc" };
      take: number;
    }): Promise<RealtimeOutboxRow[]>;
    /**
     * The claim, the mark and the release, all as CONDITIONAL writes.
     *
     * `count` is the only thing the drain trusts: a claim that updated zero rows
     * means somebody else got there first, and this drain must skip the row
     * rather than publish it too.
     */
    updateMany(args: {
      where: {
        id: string;
        publishedAt?: null;
        claimedBy?: string;
        OR?: ClaimableWhere;
      };
      data:
        | { claimedAt: Date; claimedBy: string; attempts: { increment: 1 } }
        | { publishedAt: Date; claimedAt: null; lastError: null }
        | { claimedAt: null; lastError: string }
        /**
         * The release that GIVES THE ATTEMPT BACK — see `publishClaimedRow`. Its own
         * member rather than an optional field on the one above, so an adapter cannot
         * translate the release and silently drop the decrement: the shapes are
         * documented as CLOSED sets and a dropped clause here is a row that pays for a
         * fault it had no part in.
         */
        | { claimedAt: null; lastError: string; attempts: { decrement: 1 } };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { publishedAt: { not: null; lt: Date } };
    }): Promise<{ count: number }>;
  };
}

export interface OutboxDrainResult {
  /**
   * Rows this pass put ON THE BUS.
   *
   * Normally also marked. The one gap is the honest one: if this drainer's lease had already
   * lapsed and another drainer re-claimed the row mid-publish, the mark's `claimedBy`
   * predicate matches nothing and the row stays pending — so it will be published again.
   * That is the at-least-once guarantee showing through, and counting the PUBLISH is the
   * accurate reading of what this pass did.
   */
  published: number;
  /** Rows claimed by this drain whose publish failed (they stay for retry). */
  failed: number;
  /** Rows another drain claimed first — skipped, not an error. */
  contended: number;
  /** Whether a full batch was read; the caller may want to drain again. */
  more: boolean;
  /**
   * Whether the pass STOPPED EARLY on a fault that is deployment-wide rather than a
   * property of one row: no driver in this process, or a publish the driver refused.
   *
   * `more` is always false when this is true, which is the point. The drain loop
   * `ADOPTING.md` prescribes — `while (pass.more) pass = await drain()` — is how a
   * global outage became a full budget burn: nothing publishes, `rows.length ===
   * batchSize` keeps `more` true, and a ≥100-row backlog reaches `maxAttempts` in
   * MILLISECONDS, inside one job tick. After that the candidate read (`attempts <
   * maxAttempts`) excludes every one of those rows for ever and recovery is hand-written
   * SQL. Reported rather than merely acted on, so a host's job log can say WHY a tick
   * ended with a backlog still pending.
   */
  aborted: boolean;
}

/** Everything the pass functions below need, resolved once per factory. */
export interface DrainSettings {
  logger: RealtimeLogger;
  batchSize: number;
  maxAttempts: number;
  claimLeaseMs: number;
  drainerId: string;
  /**
   * Latch so "there is no bus here" is said ONCE per outbox rather than once per tick.
   *
   * A drain on a 10 s schedule would otherwise fill the log with a line about a
   * configuration that is documented and supported (no `REDIS_URL` → clients poll), and
   * the one thing worth knowing — that enabled-outbox rows are accumulating with nothing
   * to publish them — would be the hardest line in the log to notice.
   */
  noDriver: { warned: boolean };
}

/** "Unclaimed, or claimed long enough ago that the lease lapsed." */
function claimable(settings: DrainSettings, nowMs: number): ClaimableWhere {
  return [{ claimedAt: null }, { claimedAt: { lt: new Date(nowMs - settings.claimLeaseMs) } }];
}

/**
 * Take exclusive ownership of one row, or answer `false`.
 *
 * A CLAIM-ONCE conditional write, deliberately not a read-then-write: the predicate and
 * the mutation are ONE statement, so PostgreSQL's row lock plus the re-check it performs
 * under READ COMMITTED means exactly one of two racing drains sees `count === 1`. A
 * drain that read `claimed_at IS NULL` and then wrote would have both drains publish the
 * row — the bug class this shape exists to make unrepresentable.
 *
 * The same statement bumps `attempts`, so a claim is always paid for even if the drainer
 * never comes back.
 */
async function claimRow(
  db: RealtimeOutboxDrainDb,
  settings: DrainSettings,
  row: RealtimeOutboxRow,
  now: Date,
): Promise<boolean> {
  const { count } = await db.realtimeOutboxEvent.updateMany({
    where: {
      id: row.id,
      // Re-asserted here rather than trusted from the read: the row may have been
      // published by another drain in between.
      publishedAt: null,
      OR: claimable(settings, now.getTime()),
    },
    data: { claimedAt: now, claimedBy: settings.drainerId, attempts: { increment: 1 } },
  });
  return count === 1;
}

/** What happened to one claimed row. */
type RowOutcome = "published" | "failed";

/** What one claimed row did, and whether the PASS should continue past it. */
interface RowResult {
  outcome: RowOutcome;
  /**
   * Whether the fault is deployment-wide rather than a property of this row.
   *
   * A global fault ends the pass (see {@link OutboxDrainResult.aborted}): the next row
   * would get the same answer, and spending the rest of the batch's `attempts` on it is
   * the failure mode this distinction exists to remove.
   */
  global: boolean;
}

/**
 * Publish one CLAIMED row and record the result.
 *
 * The ordinary publish path, deliberately: the outbox is not a second bus, it is a
 * durable feeder of the one that exists. `publish` never throws — a failure comes back
 * as a reason. The row id travels as the event id so a re-publish is recognisable rather
 * than merely repeated.
 *
 * ## The three failure reasons are NOT the same failure
 *
 * `attempts` is a per-ROW budget for a row nobody can publish. Charging it for a
 * deployment-wide fault turns "the bus is off" — a documented, supported degradation —
 * into permanent data loss, so each reason is read for what it actually says:
 *
 *   - `no-driver` is answered SYNCHRONOUSLY, with no I/O, by a process that has no bus.
 *     Nothing about the row is implicated, so the claim's attempt is given BACK.
 *   - `error` came out of the driver, which is shared by every row. Read as the bus
 *     being unwell: the attempt stands (that is what bounds a row that keeps failing)
 *     and the pass stops.
 *   - `invalid-topic` is a property of the ROW and of nothing else — the topic will
 *     still be malformed next pass. It burns its own budget and the pass CARRIES ON, so
 *     one bad row can never hold up the rows behind it.
 */
async function publishClaimedRow(
  db: RealtimeOutboxDrainDb,
  settings: DrainSettings,
  row: RealtimeOutboxRow,
): Promise<RowResult> {
  const result = await publishRealtimeEvent(row.topic, {
    type: row.type,
    data: row.data,
    id: row.id,
  });

  if (result.published) {
    // `claimedBy` in the predicate keeps a drainer whose lease expired mid-publish from
    // stamping a row a second drainer now owns.
    await db.realtimeOutboxEvent.updateMany({
      where: { id: row.id, publishedAt: null, claimedBy: settings.drainerId },
      data: { publishedAt: new Date(), claimedAt: null, lastError: null },
    });
    return { outcome: "published", global: false };
  }

  const reason = result.reason ?? "error";
  if (reason === "no-driver") {
    // The driver vanished between `drainOnce`'s check and this publish (a concurrent
    // `stop()`), so the row was claimed against a bus that is no longer there. Release
    // AND refund: the row did nothing wrong, and its `last_error` still records why the
    // pass gave up.
    await db.realtimeOutboxEvent.updateMany({
      where: { id: row.id, claimedBy: settings.drainerId },
      data: { claimedAt: null, lastError: reason, attempts: { decrement: 1 } },
    });
    return { outcome: "failed", global: true };
  }

  // Release the claim so the next pass retries immediately; `attempts` was already spent
  // at claim time, so this cannot loop for ever.
  await db.realtimeOutboxEvent.updateMany({
    where: { id: row.id, claimedBy: settings.drainerId },
    data: { claimedAt: null, lastError: reason },
  });
  if (row.attempts + 1 >= settings.maxAttempts) {
    settings.logger.error(
      `outbox row ${row.id} ("${row.type}" on ${row.topic}) reached ` +
        `${settings.maxAttempts} attempts and will not be retried: ${reason}`,
    );
  }
  return { outcome: "failed", global: reason !== "invalid-topic" };
}

/**
 * One drain pass: read a batch of candidates, then claim and publish each.
 *
 * ## "There is no bus to drain to" is a property of the PASS, not of each row
 *
 * The early return is two lines and it is the whole fix for the sharpest edge this module
 * had. A process with no driver answers `no-driver` synchronously, with no I/O, for every
 * row — so claiming a batch here spent one `attempts` per row against an answer no row
 * could change, `more` stayed true because nothing published, and the drain loop
 * `ADOPTING.md` prescribes burned a ≥100-row backlog to `maxAttempts` inside ONE job
 * tick. Every one of those rows is then excluded by the candidate read for ever:
 * exactly-once persistence preserved, and then the publish abandoned by a counter meant
 * for poison rows. Running without `REDIS_URL` is a documented, supported degradation
 * (clients fall back to polling); it must cost the outbox nothing.
 */
export async function drainOnce(
  db: RealtimeOutboxDrainDb,
  settings: DrainSettings,
): Promise<OutboxDrainResult> {
  if (getRealtimeDriver() === null) {
    if (!settings.noDriver.warned) {
      settings.noDriver.warned = true;
      settings.logger.warn(
        "outbox drain: no realtime driver in this process, so nothing was claimed. " +
          "Rows will accumulate until a process with a driver drains them.",
      );
    }
    return { published: 0, failed: 0, contended: 0, more: false, aborted: true };
  }

  const rows = await db.realtimeOutboxEvent.findMany({
    where: {
      publishedAt: null,
      attempts: { lt: settings.maxAttempts },
      OR: claimable(settings, Date.now()),
    },
    orderBy: { createdAt: "asc" },
    take: settings.batchSize,
  });

  const tally = { published: 0, failed: 0, contended: 0 };
  let aborted = false;
  for (const row of rows) {
    // Re-timed per row: a long batch must not hand out leases that were already half
    // spent when the pass started.
    if (!(await claimRow(db, settings, row, new Date()))) {
      tally.contended += 1;
      continue;
    }
    const result = await publishClaimedRow(db, settings, row);
    tally[result.outcome] += 1;
    if (result.global) {
      aborted = true;
      break;
    }
  }

  // A pass that gave up must not report `more`: that is the flag the prescribed
  // `while (pass.more)` loop reads, and saying "true" here is what let one tick spend
  // the whole backlog's budget on one global fault.
  return { ...tally, more: !aborted && rows.length === settings.batchSize, aborted };
}

