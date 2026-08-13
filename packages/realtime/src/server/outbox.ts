import { randomUUID } from "node:crypto";

import { isValidTopic } from "../core/topics";
import type { RealtimeLogger } from "../core/types";

import {
  drainOnce,
  type DrainSettings,
  type OutboxDrainResult,
  type RealtimeOutboxDrainDb,
} from "./outbox-drain";

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
 *   after rows created later. Nor is `created_at` itself commit order:
 *   `CURRENT_TIMESTAMP` is transaction-START time in PostgreSQL and the ordering
 *   has no tiebreaker, so even one drainer can claim two rows in an order their
 *   commits did not have. Events carry identifiers and consumers re-read, so
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
 * client (or transaction client) through the interfaces here and in
 * `./outbox-drain.ts`; any object with a `realtimeOutboxEvent` delegate of that
 * shape plugs in, which is what lets the harness satisfy it over raw PGlite.
 *
 * ## Where the halves live
 *
 * This module owns the ENQUEUE side, the tuning constants and the factory. The
 * claim protocol and one pass over it live in `./outbox-drain.ts` — same seam the
 * text above describes, because a write happens inside a host's transaction and
 * needs nothing the drain knows.
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

/**
 * The transaction-client slice `enqueueRealtimeEvent` needs.
 *
 * ## `$transaction?: never` is the only enforcement this guarantee can have
 *
 * "Exactly-once PERSISTENCE" is stated as a STRUCTURAL property, and it only holds if
 * the row is written on the same transaction as its cause. Without this field the shape
 * is satisfied by the BASE client too, so
 *
 *     await prisma.order.update(…);
 *     await enqueueRealtimeEvent(prisma, …);   // two independent transactions
 *
 * compiles, runs, and produces exactly the non-atomic pair the outbox exists to
 * eliminate — no type error, no runtime error, green tests. A
 * `Prisma.TransactionClient` has NO `$transaction` (that is what makes it a transaction
 * client), so declaring it `never` here keeps every `tx` assignable and turns the base
 * client into a compile error. `ADOPTING.md` rule 4 already tells hosts the right thing;
 * a rule cannot be type-checked, and this is the one place the compiler can hold it.
 */
export interface RealtimeOutboxWriteDb {
  $transaction?: never;
  realtimeOutboxEvent: {
    create(args: {
      data: { topic: string; type: string; data: unknown };
    }): Promise<unknown>;
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
 *
 * What it is NOT charged for is a fault the row had no part in. This is a per-ROW
 * budget; a deployment-wide fault (no driver in this process) spends none of it,
 * and ends the pass instead — see `drainOnce` and `publishClaimedRow`. Without
 * that distinction "the bus is off" parked an entire backlog permanently, which
 * inverts what the outbox is for.
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

export interface RealtimeOutbox {
  /**
   * One pass: claim a batch of pending rows in `created_at` order and publish each.
   *
   * Not literally commit order, and the difference is worth naming: `created_at`
   * defaults to `CURRENT_TIMESTAMP`, which in PostgreSQL is transaction-START time, and
   * the ordering carries no tiebreaker. So two rows can be claimed in an order their
   * commits did not have. That is inside the stated guarantee — there is NO total order
   * here, deliberately — and it is why the payload rule (identifiers, never state)
   * matters.
   */
  drain(): Promise<OutboxDrainResult>;
  /** Delete published rows older than `olderThanMs`. Returns how many went. */
  purgePublished(olderThanMs: number): Promise<number>;
}

export function createRealtimeOutbox(options: RealtimeOutboxOptions): RealtimeOutbox {
  const settings: DrainSettings = {
    logger: options.logger ?? console,
    batchSize: options.batchSize ?? OUTBOX_DEFAULT_BATCH_SIZE,
    maxAttempts: options.maxAttempts ?? OUTBOX_DEFAULT_MAX_ATTEMPTS,
    claimLeaseMs: options.claimLeaseMs ?? OUTBOX_DEFAULT_CLAIM_LEASE_MS,
    drainerId: options.drainerId ?? randomUUID(),
    noDriver: { warned: false },
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

/**
 * The drain's own surface, re-exported so `./index.ts` and every consumer name ONE module
 * for the outbox. The split is an internal size boundary, not a change to the API.
 */
export {
  type OutboxDrainResult,
  type RealtimeOutboxDrainDb,
  type RealtimeOutboxRow,
} from "./outbox-drain";
