import { randomUUID } from "node:crypto";

import { publishRealtimeEvent } from "../core/runtime";
import { isValidTopic } from "../core/topics";
import type { RealtimeLogger } from "../core/types";

/**
 * The transactional OUTBOX — the durable half of the event system (12-16).
 *
 * ## The gap it closes
 *
 * Every publisher in a host is fire-and-forget next to the write it describes:
 * commit, then `publishRealtimeEvent`. That is the right LATENCY path — a dead
 * bus must cost latency, never the mutation — but it means a process that dies
 * BETWEEN the commit and the publish loses the event with no trace, and a bus
 * outage during that window does the same. For a payload-free hint the polling
 * floor covers it; for an event a host wants DURABLY fanned out (a webhook
 * relay, an audit trail, cross-service integration) "usually arrives" is not a
 * contract.
 *
 * ## The shape
 *
 * 1. `enqueueRealtimeEvent(tx, …)` writes one row to `realtime_outbox_events`
 *    **inside the same transaction as the domain write**. Either both commit or
 *    neither does — the event cannot exist without its cause, nor the cause
 *    without its event.
 * 2. A drain — `createRealtimeOutbox({ db }).drain()`, run by a worker
 *    (`@12-apps/jobs` is the natural driver; ADOPTING.md has the wiring) —
 *    CLAIMS each pending row, publishes it through the ordinary bus, and marks
 *    `published_at` on success.
 *
 * ## The delivery guarantee, stated honestly
 *
 * - **Exactly-once PERSISTENCE.** The row commits atomically with the write.
 * - **At-least-once PUBLISH into the bus, with idempotent consumers.** NOT
 *   exactly-once, and it is not worth pretending otherwise: a drainer that dies
 *   after `driver.publish` resolved but before the mark lands publishes that row
 *   again on a later pass, once its claim lease expires. What the claim protocol
 *   below does remove is the CONCURRENT duplicate — two drains racing one row —
 *   and the lost row.
 * - **Best-effort DELIVERY to subscribers**, unchanged. The bus is fan-out with
 *   no replay, so a subscriber offline at publish time misses the event forever.
 *   Polling stays the correctness floor on every consumer.
 * - **No total ORDER.** Rows are claimed in `created_at` order, but two drains
 *   running concurrently can publish out of order, and a retried row arrives
 *   after rows created later. Events carry identifiers and consumers re-read, so
 *   order is not information anybody is entitled to here.
 *
 * A duplicate is harmless BY CONSTRUCTION rather than by luck: an event carries
 * identifiers, never state, so acting on it twice means re-reading twice. The
 * publish additionally reuses the ROW ID as the event id (see
 * `RealtimeEventInput.id`), so a consumer that wants explicit de-duplication has
 * a stable key instead of two indistinguishable emissions.
 *
 * Anything needing more than that — per-subscriber replay, ordering across
 * topics, exactly-once side effects — is a different system. Say so rather than
 * implying it here.
 *
 * ## The db seam is structural, like every store in this repo
 *
 * The package never imports a generated Prisma client. A host passes its own
 * client (or transaction client) through the interfaces below; any object with a
 * `realtimeOutboxEvent` delegate of this shape plugs in, which is what lets the
 * harness satisfy it over raw PGlite.
 *
 * ## Tenancy, and why there is no soft-delete filter here
 *
 * `realtime_outbox_events` is INFRASTRUCTURE, not a tenant-scoped domain table:
 * it carries no `client_id` and no `archived_at`, and the drain reads it unscoped
 * because it fans out for the whole deployment. The tenant lives inside the topic
 * name (`tenant:<id>:<domain>`), written by `enqueue` from ids the CALLER
 * resolved, and gated on the way out by the subscribe surface's `authorize` seam
 * — so a row cannot address a tenant its writer could not address, and a
 * subscriber cannot hear a topic it was not granted. Nothing in this module is
 * reachable over HTTP: `createApiEvents` exposes no outbox route, deliberately.
 */

/** What an enqueue writes. `data` follows the payload rule: identifiers only. */
export interface RealtimeOutboxInput {
  /** Fully-qualified topic name, e.g. `tenant:<id>:orders`. */
  topic: string;
  /** Dot-namespaced event type, stable on the wire. */
  type: string;
  /** Identifiers only — never state. Defaults to `{}`. */
  data?: unknown;
}

/** One stored outbox row, as the drain reads it. */
export interface RealtimeOutboxRow {
  id: string;
  topic: string;
  type: string;
  data: unknown;
  attempts: number;
}

/** The transaction-client slice `enqueueRealtimeEvent` needs. */
export interface RealtimeOutboxWriteDb {
  realtimeOutboxEvent: {
    create(args: {
      data: { topic: string; type: string; data: unknown };
    }): Promise<unknown>;
  };
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
        | { claimedAt: null; lastError: string };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { publishedAt: { not: null; lt: Date } };
    }): Promise<{ count: number }>;
  };
}

/**
 * Write one event into the outbox, on the SAME transaction client as the domain
 * write it describes:
 *
 *     await prisma.$transaction(async (tx) => {
 *       await tx.order.update({ … });
 *       await enqueueRealtimeEvent(tx, {
 *         topic: tenantTopic(tenantId, "orders"),
 *         type: "orders.changed",
 *       });
 *     });
 *
 * Throws on a malformed topic — that is a programming error at the call site, and
 * it must fail the transaction rather than commit a row no drain can publish.
 */
export async function enqueueRealtimeEvent(
  tx: RealtimeOutboxWriteDb,
  input: RealtimeOutboxInput,
): Promise<void> {
  if (!isValidTopic(input.topic)) {
    throw new Error(`enqueueRealtimeEvent: malformed topic "${input.topic}"`);
  }
  await tx.realtimeOutboxEvent.create({
    data: { topic: input.topic, type: input.type, data: input.data ?? {} },
  });
}

/** How many rows one drain pass reads. */
export const OUTBOX_DEFAULT_BATCH_SIZE = 100;

/**
 * After this many claims a row is left for a human: the drain stops picking it up
 * (`attempts < maxAttempts` in the read), but the row — with its `last_error` —
 * stays until a purge or a manual reset.
 *
 * Silent infinite retry would grind the drain on a poison row forever; silent
 * deletion would be the exact loss the outbox exists to prevent.
 *
 * `attempts` counts CLAIMS, not failures, and that is deliberate: a drainer that
 * crashes mid-publish records nothing, so counting failures would let a row that
 * kills the process be retried for ever. Counting claims bounds it either way.
 */
export const OUTBOX_DEFAULT_MAX_ATTEMPTS = 10;

/**
 * How long a claim is honoured before another drain may take the row.
 *
 * It is a LEASE, not a lock: the holder may have died, and nothing can tell the
 * difference from outside. Long enough that a slow publish is not stolen
 * mid-flight, short enough that a crashed drainer's rows are not stranded for a
 * shift. A stolen-then-completed row is a duplicate publish, which is inside the
 * guarantee stated above.
 */
export const OUTBOX_DEFAULT_CLAIM_LEASE_MS = 60_000;

export interface RealtimeOutboxOptions {
  /** Lazy provider, same doctrine as report-builder's `db`. */
  db: () => Promise<RealtimeOutboxDrainDb> | RealtimeOutboxDrainDb;
  logger?: RealtimeLogger;
  batchSize?: number;
  maxAttempts?: number;
  claimLeaseMs?: number;
  /**
   * Identifies THIS drainer in `claimed_by`, for operators reading the table and
   * for the mark's own predicate. Defaults to a per-instance uuid.
   */
  drainerId?: string;
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
}

export interface RealtimeOutbox {
  /** One pass: claim a batch of pending rows in commit order and publish each. */
  drain(): Promise<OutboxDrainResult>;
  /** Delete published rows older than `olderThanMs`. Returns how many went. */
  purgePublished(olderThanMs: number): Promise<number>;
}

/** Everything the pass functions below need, resolved once per factory. */
interface DrainSettings {
  logger: RealtimeLogger;
  batchSize: number;
  maxAttempts: number;
  claimLeaseMs: number;
  drainerId: string;
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

/**
 * Publish one CLAIMED row and record the result.
 *
 * The ordinary publish path, deliberately: the outbox is not a second bus, it is a
 * durable feeder of the one that exists. `publish` never throws — a failure comes back
 * as a reason. The row id travels as the event id so a re-publish is recognisable rather
 * than merely repeated.
 */
async function publishClaimedRow(
  db: RealtimeOutboxDrainDb,
  settings: DrainSettings,
  row: RealtimeOutboxRow,
): Promise<RowOutcome> {
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
    return "published";
  }

  const reason = result.reason ?? "error";
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
  return "failed";
}

/** One drain pass: read a batch of candidates, then claim and publish each. */
async function drainOnce(
  db: RealtimeOutboxDrainDb,
  settings: DrainSettings,
): Promise<OutboxDrainResult> {
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
  for (const row of rows) {
    // Re-timed per row: a long batch must not hand out leases that were already half
    // spent when the pass started.
    if (!(await claimRow(db, settings, row, new Date()))) {
      tally.contended += 1;
      continue;
    }
    const outcome = await publishClaimedRow(db, settings, row);
    tally[outcome] += 1;
  }

  return { ...tally, more: rows.length === settings.batchSize };
}

export function createRealtimeOutbox(options: RealtimeOutboxOptions): RealtimeOutbox {
  const settings: DrainSettings = {
    logger: options.logger ?? console,
    batchSize: options.batchSize ?? OUTBOX_DEFAULT_BATCH_SIZE,
    maxAttempts: options.maxAttempts ?? OUTBOX_DEFAULT_MAX_ATTEMPTS,
    claimLeaseMs: options.claimLeaseMs ?? OUTBOX_DEFAULT_CLAIM_LEASE_MS,
    drainerId: options.drainerId ?? randomUUID(),
  };

  return {
    async drain(): Promise<OutboxDrainResult> {
      return drainOnce(await options.db(), settings);
    },

    async purgePublished(olderThanMs: number): Promise<number> {
      const db = await options.db();
      const { count } = await db.realtimeOutboxEvent.deleteMany({
        where: { publishedAt: { not: null, lt: new Date(Date.now() - olderThanMs) } },
      });
      if (count > 0) settings.logger.info(`outbox purge: ${count} published row(s) removed.`);
      return count;
    },
  };
}
