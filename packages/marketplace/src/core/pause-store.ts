import { randomUUID } from "node:crypto";

import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The pause record: one row per (store, marketplace), the engine's memory of
 * what it asked the marketplace and what the marketplace holds (FUT-4851).
 *
 * Two fields say two different things, and the job reconciles them:
 *
 * - `wanted` is the host's LAST ask (PAUSED or OPEN). The last ask wins: a
 *   resume that lands while a pause is in flight, or a pause while a resume
 *   is, only rewrites `wanted`, and the job re-reads it after every call.
 * - `state` is where the marketplace stands as far as the engine knows:
 *   OPEN → PAUSING → PAUSED → RESUMING → OPEN, or FAILED with a code.
 *
 * What the engine holds on the marketplace is `externalId` (the closure's id,
 * for an `interruption`), `sentUntil` (the end the marketplace was given; the
 * only proof of a `switch` the engine turned off) and `attemptKey` (the key a
 * create went out under, kept while its answer is in doubt). `retiredExternalId`
 * is the previous closure an extend replaced, still to be deleted. Nothing
 * else is ever deleted: a closure the owner made by hand is in none of them.
 */

/** Where the marketplace stands, as far as the engine knows. Vocabulary, not copy. */
export type StorePauseState = "OPEN" | "PAUSING" | "PAUSED" | "RESUMING" | "FAILED";

/** The host's last ask. */
export type StorePauseWanted = "PAUSED" | "OPEN";

/**
 * Why a record is FAILED. Machine codes, never a sentence: the host renders
 * them, and the marketplace's own words travel in `failureDetail`.
 *
 * - `UNSUPPORTED`: the marketplace's adapter has no availability capability.
 * - `NOT_CONNECTED`: no credentials or no merchant id on the connection.
 * - `PAUSE_REFUSED` / `RESUME_REFUSED`: the marketplace said no (a final 4xx).
 * - `PAUSE_UNANSWERED` / `RESUME_UNANSWERED`: every attempt failed without an
 *   answer (5xx, a timeout, a rate limit), or the sweep gave up waiting.
 */
export type StorePauseFailureCode =
  | "UNSUPPORTED"
  | "NOT_CONNECTED"
  | "PAUSE_REFUSED"
  | "PAUSE_UNANSWERED"
  | "RESUME_REFUSED"
  | "RESUME_UNANSWERED";

/** One record as the engine reads it. */
export interface StorePauseRow {
  id: string;
  clientId: string;
  provider: string;
  state: StorePauseState;
  wanted: StorePauseWanted;
  until: Date | null;
  reason: string | null;
  timeZone: string | null;
  externalId: string | null;
  sentUntil: Date | null;
  attemptKey: string | null;
  retiredExternalId: string | null;
  failureCode: StorePauseFailureCode | null;
  failureDetail: string | null;
  requestedAt: Date;
  leaseUntil: Date | null;
  pausedAt: Date | null;
  resumedAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date | null;
}

/** The job's wire name. */
export const MARKETPLACE_AVAILABILITY_JOB = "marketplace.availability";

/** The job's payload: identifiers only; the ask lives on the row. */
export interface AvailabilityJobPayload {
  clientId: string;
  provider: MarketplaceProvider;
}

/** How long one run holds a record, so two runs never call the marketplace for it at once. */
export const STORE_PAUSE_LEASE_MS = 2 * 60_000;

/** The marketplace's words are kept to this length: a column a person reads in a list. */
const DETAIL_MAX = 300;

/** The pause delegate, or a clear refusal on a host that has not composed the model. */
export function pauseTable(db: MarketplaceDb): NonNullable<MarketplaceDb["marketplaceStorePause"]> {
  const table = db.marketplaceStorePause;
  if (!table) {
    throw new Error(
      "@12-apps/marketplace: the store pause needs the MarketplaceStorePause model " +
        "(migration 20261113180000_marketplace_store_pause); compose the partial and migrate.",
    );
  }
  return table;
}

/** Whether a host's database has the pause model at all. */
export function hasPauseTable(db: MarketplaceDb): boolean {
  return db.marketplaceStorePause !== undefined;
}

/** One record by (store, marketplace). */
export async function readPause(ctx: EngineContext, clientId: string, provider: string): Promise<StorePauseRow | null> {
  const table = pauseTable(await ctx.ports.db());
  return (await table.findFirst({ where: { clientId, provider } })) as StorePauseRow | null;
}

/** Whether anything of ours may stand on the marketplace for this record. */
export function holdsSomething(row: Pick<StorePauseRow, "externalId" | "sentUntil" | "attemptKey" | "retiredExternalId">): boolean {
  return row.externalId !== null || row.sentUntil !== null || row.attemptKey !== null || row.retiredExternalId !== null;
}

/** A fresh key for one closure's create. */
export function newAttemptKey(): string {
  return randomUUID();
}

/** The marketplace's words, cut for the column. */
export function detailOf(message: string): string {
  return message.slice(0, DETAIL_MAX);
}

/** The dedupe key of one ask: per record and per ask instant, so a new ask is never swallowed. */
export function availabilityDedupeKey(payload: AvailabilityJobPayload, requestedAt: Date, suffix = ""): string {
  return `${MARKETPLACE_AVAILABILITY_JOB}:${payload.clientId}:${payload.provider}:${requestedAt.getTime()}${suffix}`;
}

/** Queue the job for one record. The queue port never throws; a refusal is left to the sweep. */
export async function enqueueAvailability(
  ctx: EngineContext,
  payload: AvailabilityJobPayload,
  dedupeKey: string,
): Promise<boolean> {
  const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_AVAILABILITY_JOB, payload, { dedupeKey });
  if (!outcome.enqueued) {
    ctx.ports.logger.warn(
      `${MARKETPLACE_AVAILABILITY_JOB}: ${payload.provider} for ${payload.clientId} was not queued; the sweep will re-queue it` +
        (outcome.reason ? ` (${outcome.reason})` : ""),
    );
  }
  return outcome.enqueued;
}
