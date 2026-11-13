import type { AdapterCallContext, OutboundResult } from "./adapter";
import { readOutboundConnection } from "./integration";
import type { OutboundAttempt } from "./outbound";
import type { MarketplaceAvailability, StorePauseRef, StorePauseResult } from "./pause-port";
import {
  STORE_PAUSE_LEASE_MS,
  detailOf,
  newAttemptKey,
  pauseTable,
  readPause,
  holdsSomething,
  type AvailabilityJobPayload,
  type StorePauseFailureCode,
  type StorePauseRow,
} from "./pause-store";
import { ended, heldIds, refOf, retire, retiredOf, retiredValue, withRetired } from "./pause-retired";
import type { EngineContext } from "./ports";

/**
 * The `marketplace.availability` job: bring one marketplace in line with the
 * host's last ask for one store (FUT-4851).
 *
 * The job re-reads the record before every call and after it, so the last ask
 * wins: a resume that lands while a pause call is in flight finds the closure
 * that call created recorded, and deletes it on the next step. A run holds a
 * short lease on the record, so two runs never call one marketplace for one
 * store at once. The answer rule is the outbound engine's: 2xx done, a final
 * 4xx FAILED with the marketplace's words, anything else retried by the queue
 * until the last attempt, which stamps `*_UNANSWERED`.
 */

/** What one run did. */
export type AvailabilityOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "done"; state: StorePauseRow["state"] }
  | { kind: "failed"; code: StorePauseFailureCode };

/** Thrown so the queue retries. Its message is what the job log reads. */
export class AvailabilityRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityRetryError";
  }
}

/** How many steps one run takes at most: a pause, its retirement, a flip to resume and its deletes. */
const MAX_STEPS = 8;

interface Run {
  ctx: EngineContext;
  availability: MarketplaceAvailability;
  call: AdapterCallContext;
  merchantId: string;
  attempt: OutboundAttempt;
}

type Step = { settled: false } | { settled: true; outcome: AvailabilityOutcome };
const AGAIN: Step = { settled: false };

async function write(ctx: EngineContext, where: Record<string, unknown>, data: Record<string, unknown>): Promise<number> {
  const table = pauseTable(await ctx.ports.db());
  return (await table.updateMany({ where, data })).count;
}

/**
 * FAILED with a code, predicated on the ask the step acted on still standing.
 * `detail` is the marketplace's own words (a refusal's) or null: an engine
 * sentence never reaches the row a host renders; `log` goes to the logger.
 * Returns whether it moved.
 */
async function failRow(
  ctx: EngineContext,
  now: Date,
  row: StorePauseRow,
  code: StorePauseFailureCode,
  failure: { detail: string | null; log: string },
): Promise<boolean> {
  const moved = await write(
    ctx,
    { id: row.id, wanted: row.wanted },
    {
      state: "FAILED",
      failureCode: code,
      failureDetail: failure.detail === null || failure.detail === "" ? null : detailOf(failure.detail),
      failedAt: now,
    },
  );
  if (moved === 0) return false;
  ctx.ports.logger.error(`marketplace.availability: ${row.provider} for ${row.clientId} failed: ${code} (${failure.log})`);
  ctx.ports.publishChanged(row.clientId);
  return true;
}

async function fail(run: Run, row: StorePauseRow, code: StorePauseFailureCode, failure: { detail: string | null; log: string }): Promise<Step> {
  const moved = await failRow(run.ctx, run.call.now, row, code, failure);
  return moved ? { settled: true, outcome: { kind: "failed", code } } : AGAIN;
}

/** A refusal fails at once with the marketplace's words; a retry throws until the last attempt, which fails. */
async function unanswered(
  run: Run,
  row: StorePauseRow,
  result: Exclude<OutboundResult, { kind: "accepted" }>,
  codes: { refused: StorePauseFailureCode; unanswered: StorePauseFailureCode },
): Promise<Step> {
  if (result.kind === "refused") {
    return fail(run, row, codes.refused, { detail: result.message, log: `refused ${result.status}: ${result.message}` });
  }
  if (run.attempt.attempt < run.attempt.maxAttempts) {
    throw new AvailabilityRetryError(`${row.provider} for ${row.clientId}: ${result.reason}`);
  }
  return fail(run, row, codes.unanswered, { detail: null, log: result.reason });
}

const PAUSE_CODES = { refused: "PAUSE_REFUSED", unanswered: "PAUSE_UNANSWERED" } as const;
const RESUME_CODES = { refused: "RESUME_REFUSED", unanswered: "RESUME_UNANSWERED" } as const;

/**
 * Whether the marketplace holds a closure to exactly this end. An earlier end
 * is renewed like a later one: the store is never closed on a marketplace
 * longer than the kitchen's own pause (the owner, 2026-11-12).
 */
const upToDate = (row: StorePauseRow): boolean =>
  row.sentUntil !== null && row.until !== null && row.sentUntil.getTime() === row.until.getTime();

/** The closure the engine holds and still stands: an interruption's id, or a switch it turned off. */
const holds = (row: StorePauseRow): boolean => row.externalId !== null || row.sentUntil !== null;

async function calledSafely<T extends StorePauseResult | OutboundResult>(call: () => Promise<T>): Promise<T | { kind: "retry"; reason: string }> {
  try {
    return await call();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** What a create under the row's key carried, for recognising its closure. */
const sentOf = (row: StorePauseRow, until: Date | null) =>
  row.attemptKey !== null && until !== null ? { until, reason: row.reason ?? "", timeZone: row.timeZone ?? "UTC" } : null;

/**
 * Write a fresh key and the end it will carry BEFORE the call, predicated on
 * no key being in doubt: a resume that lands meanwhile then knows a closure
 * may exist, and a switch is never turned on before the engine tried to turn
 * it off. False when the row moved under us.
 */
async function claimKey(run: Run, row: StorePauseRow): Promise<string | null> {
  const key = newAttemptKey();
  const moved = await write(run.ctx, { id: row.id, attemptKey: null, wanted: "PAUSED" }, { attemptKey: key, attemptUntil: row.until });
  return moved > 0 ? key : null;
}

/** Close the store, or move the end of the closure the engine holds. */
async function sendPause(run: Run, row: StorePauseRow): Promise<Step> {
  const until = row.until as Date;
  const key = row.attemptKey ?? (await claimKey(run, row));
  if (key === null) return AGAIN;
  const request = { merchantId: run.merchantId, until, reason: row.reason ?? "", key, timeZone: row.timeZone ?? "UTC", keep: heldIds(row) };
  const extend = run.availability.extend;
  const ref: StorePauseRef = { merchantId: run.merchantId, externalId: row.externalId, key: null, sent: null };
  const result = await calledSafely(() =>
    holds(row) && extend ? extend(run.call, ref, request) : run.availability.pause(run.call, request),
  );
  if (result.kind === "refused") {
    // A final refusal created nothing: no key is left in doubt.
    await write(run.ctx, { id: row.id, attemptKey: key }, { attemptKey: null, attemptUntil: null });
    return unanswered(run, row, result, PAUSE_CODES);
  }
  // Otherwise the key stays on the row: a create whose answer was lost is found under it.
  if (result.kind !== "paused") return unanswered(run, row, result, PAUSE_CODES);
  // A new closure replaced the one the engine held: the old one, with its end, joins the list to delete.
  const replaced = row.externalId !== null && result.externalId !== row.externalId;
  const retired = replaced
    ? withRetired(run.ctx, row, { by: "id", value: row.externalId as string, end: row.sentUntil })
    : retiredOf(row);
  await write(
    run.ctx,
    { id: row.id },
    { externalId: result.externalId, sentUntil: result.until, attemptKey: null, attemptUntil: null, retiredExternalIds: retiredValue(retired) },
  );
  return AGAIN;
}

/**
 * A key whose create carried another end than the one now asked, on an
 * interruption: the closure its lost answer may have created joins the list
 * to delete (by the key, with that end), and the new closure is created
 * first, so the store is never open in between. A switch has one closure:
 * the next OFF is simply sent again, never an ON in the middle of a pause.
 */
async function resolveStaleKey(run: Run, row: StorePauseRow): Promise<Step | null> {
  if (run.availability.kind === "switch") return null;
  if (row.attemptKey === null || row.attemptUntil === null || row.attemptUntil.getTime() === row.until?.getTime()) return null;
  const retired = withRetired(run.ctx, row, { by: "key", value: row.attemptKey, end: row.attemptUntil });
  await write(
    run.ctx,
    { id: row.id, attemptKey: row.attemptKey },
    { attemptKey: null, attemptUntil: null, retiredExternalIds: retiredValue(retired) },
  );
  return AGAIN;
}

async function stepPause(run: Run, current: StorePauseRow): Promise<Step> {
  let row = current;
  if (row.until === null) return fail(run, row, "PAUSE_REFUSED", { detail: null, log: "no end on the record" });
  const stale = await resolveStaleKey(run, row);
  if (stale) return stale;
  // The new closure first; only then are the replaced ones deleted, so the store is never open in between.
  if (!upToDate(row)) return sendPause(run, row);
  if (row.retiredExternalIds !== null) {
    const left = await retire(run, row);
    await write(run.ctx, { id: row.id }, { retiredExternalIds: retiredValue(left) });
    row = (await readPause(run.ctx, row.clientId, row.provider)) ?? row;
  }
  const moved = await write(
    run.ctx,
    { id: row.id, wanted: "PAUSED", until: row.until },
    { state: "PAUSED", pausedAt: row.pausedAt ?? run.call.now, failureCode: null, failureDetail: null, failedAt: null },
  );
  // The ask moved under us: the next step reads it.
  if (moved === 0) return AGAIN;
  run.ctx.ports.publishChanged(row.clientId);
  return { settled: true, outcome: { kind: "done", state: "PAUSED" } };
}

/** The next closure of ours to delete, and what deleting it clears; null when nothing of ours stands. */
interface NextDelete {
  ref: StorePauseRef;
  clear: Record<string, null | string>;
  /** A closure a renewal replaced: a final refusal drops it rather than failing the resume. */
  replaced?: boolean;
}

function nextDelete(row: StorePauseRow, kind: MarketplaceAvailability["kind"]): NextDelete | null {
  if (kind === "switch") {
    // A switch has one closure: the store the engine turned off (or may have, while an answer is in doubt).
    if (row.sentUntil === null && row.attemptKey === null) return null;
    return {
      ref: { merchantId: "", externalId: null, key: row.attemptKey, sent: sentOf(row, row.attemptUntil) },
      clear: { sentUntil: null, attemptKey: null, attemptUntil: null, externalId: null },
    };
  }
  if (row.externalId !== null) {
    return { ref: { merchantId: "", externalId: row.externalId, key: null, sent: null }, clear: { externalId: null, sentUntil: null } };
  }
  const [retired, ...rest] = retiredOf(row);
  if (retired !== undefined) return { ref: refOf(retired, row, ""), clear: { retiredExternalIds: retiredValue(rest) }, replaced: true };
  if (row.attemptKey !== null) {
    return {
      ref: { merchantId: "", externalId: null, key: row.attemptKey, sent: sentOf(row, row.attemptUntil), keep: heldIds(row) },
      clear: { attemptKey: null, attemptUntil: null, sentUntil: null },
    };
  }
  return null;
}

/** Drop, without a call, the replaced closures whose own end has passed. Returns the row as it now stands. */
async function pruneEnded(run: Run, row: StorePauseRow): Promise<StorePauseRow> {
  const list = retiredOf(row);
  const live = list.filter((entry) => !ended(entry, run.call.now));
  if (live.length === list.length) return row;
  await write(run.ctx, { id: row.id }, { retiredExternalIds: retiredValue(live) });
  return { ...row, retiredExternalIds: retiredValue(live) };
}

async function stepResume(run: Run, current: StorePauseRow): Promise<Step> {
  const row = await pruneEnded(run, current);
  const next = nextDelete(row, run.availability.kind);
  if (next === null) {
    await write(
      run.ctx,
      { id: row.id, wanted: "OPEN" },
      { state: "OPEN", sentUntil: null, resumedAt: run.call.now, failureCode: null, failureDetail: null, failedAt: null },
    );
    run.ctx.ports.publishChanged(row.clientId);
    return { settled: true, outcome: { kind: "done", state: "OPEN" } };
  }
  const ref = { ...next.ref, merchantId: run.merchantId };
  const result = await calledSafely(() => run.availability.resume(run.call, ref));
  const dropped = result.kind === "refused" && next.replaced === true;
  if (dropped) {
    run.ctx.ports.logger.warn(
      `marketplace.availability: ${row.provider} for ${row.clientId}: a replaced closure's delete was refused ` +
        `(${result.status}: ${result.message}); dropped, it ends on its own`,
    );
  }
  if (result.kind !== "accepted" && !dropped) return unanswered(run, row, result, RESUME_CODES);
  // Cleared whatever the ask now is: the closure is gone, and a pause asked meanwhile creates a new one.
  await write(run.ctx, { id: row.id }, next.clear);
  return AGAIN;
}

/** The call context, or the reason the connection cannot be used. */
async function callContext(ctx: EngineContext, row: StorePauseRow): Promise<{ call: AdapterCallContext; merchantId: string } | string> {
  const db = await ctx.ports.db();
  const integration = (await db.marketplaceIntegration.findUnique({
    where: { clientId_provider: { clientId: row.clientId, provider: row.provider } },
    select: { externalMerchantId: true },
  })) as { externalMerchantId: string | null } | null;
  if (!integration?.externalMerchantId) return "no merchant id on the connection";
  try {
    const connection = await readOutboundConnection(ctx, row.clientId, row.provider);
    if (!connection) return "no credentials on file";
    return {
      merchantId: integration.externalMerchantId,
      call: { http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection },
    };
  } catch (error) {
    return `credentials do not open: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Take the record's lease; the instant written, or null when another run holds it. */
async function lease(ctx: EngineContext, row: StorePauseRow, now: Date): Promise<Date | null> {
  const until = new Date(now.getTime() + STORE_PAUSE_LEASE_MS);
  const taken = await write(ctx, { id: row.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, { leaseUntil: until });
  return taken > 0 ? until : null;
}

async function steps(run: Run, first: StorePauseRow): Promise<AvailabilityOutcome> {
  let row: StorePauseRow | null = first;
  for (let step = 0; step < MAX_STEPS && row; step += 1) {
    const result = row.wanted === "PAUSED" ? await stepPause(run, row) : await stepResume(run, row);
    if (result.settled) return result.outcome;
    row = await readPause(run.ctx, first.clientId, first.provider);
  }
  return { kind: "skipped", reason: "the ask kept changing; the next run or the sweep finishes it" };
}

async function runOnce(ctx: EngineContext, payload: AvailabilityJobPayload, attempt: OutboundAttempt): Promise<AvailabilityOutcome> {
  const row = await readPause(ctx, payload.clientId, payload.provider);
  if (!row) return { kind: "skipped", reason: "no pause record" };
  // An OPEN row that still holds something (a call whose answer was lost under a resume) is finished, not skipped.
  const settled = row.state === "FAILED" || (row.state === "OPEN" && !holdsSomething(row));
  if (settled) return { kind: "skipped", reason: `the record is ${row.state}` };
  const availability = ctx.registry.get(row.provider)?.availability;
  const now = ctx.ports.clock.now();
  if (!availability) {
    await failRow(ctx, now, row, "UNSUPPORTED", { detail: null, log: "the adapter has no availability capability" });
    return { kind: "failed", code: "UNSUPPORTED" };
  }
  const held = await lease(ctx, row, now);
  if (held === null) {
    if (attempt.attempt < attempt.maxAttempts) throw new AvailabilityRetryError(`${row.provider} for ${row.clientId}: another run holds it`);
    return { kind: "skipped", reason: "another run holds the record" };
  }
  try {
    const opened = await callContext(ctx, row);
    if (typeof opened === "string") {
      await failRow(ctx, now, row, "NOT_CONNECTED", { detail: null, log: opened });
      return { kind: "failed", code: "NOT_CONNECTED" };
    }
    return await steps({ ctx, availability, attempt, ...opened }, row);
  } finally {
    // Only this run's own lease: one that expired and was taken by another run is that run's.
    await write(ctx, { id: row.id, leaseUntil: held }, { leaseUntil: null });
  }
}

/**
 * Run one queued availability call. Throws {@link AvailabilityRetryError} for
 * an answer worth retrying before the last attempt; any other throw (an
 * adapter bug, a database error) is rethrown for the queue to retry, and on
 * the last attempt ends FAILED as unanswered.
 */
export async function runAvailability(
  ctx: EngineContext,
  payload: AvailabilityJobPayload,
  attempt: OutboundAttempt,
): Promise<AvailabilityOutcome> {
  try {
    return await runOnce(ctx, payload, attempt);
  } catch (error) {
    if (error instanceof AvailabilityRetryError || attempt.attempt < attempt.maxAttempts) throw error;
    const row = await readPause(ctx, payload.clientId, payload.provider);
    if (!row) return { kind: "skipped", reason: "no pause record" };
    const code = row.wanted === "PAUSED" ? "PAUSE_UNANSWERED" : "RESUME_UNANSWERED";
    await failRow(ctx, ctx.ports.clock.now(), row, code, { detail: null, log: error instanceof Error ? error.message : String(error) });
    return { kind: "failed", code };
  }
}
