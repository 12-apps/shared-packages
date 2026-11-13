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
  type AvailabilityJobPayload,
  type StorePauseFailureCode,
  type StorePauseRow,
} from "./pause-store";
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
const MAX_STEPS = 6;

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

/** FAILED with a code, predicated on the ask the step acted on still standing. Returns whether it moved. */
async function failRow(
  ctx: EngineContext,
  now: Date,
  row: StorePauseRow,
  code: StorePauseFailureCode,
  detail: string | null,
): Promise<boolean> {
  const moved = await write(
    ctx,
    { id: row.id, wanted: row.wanted },
    { state: "FAILED", failureCode: code, failureDetail: detail === null ? null : detailOf(detail), failedAt: now },
  );
  if (moved === 0) return false;
  ctx.ports.logger.error(`marketplace.availability: ${row.provider} for ${row.clientId} failed: ${code} ${detail ?? ""}`);
  ctx.ports.publishChanged(row.clientId);
  return true;
}

async function fail(run: Run, row: StorePauseRow, code: StorePauseFailureCode, detail: string | null): Promise<Step> {
  const moved = await failRow(run.ctx, run.call.now, row, code, detail);
  return moved ? { settled: true, outcome: { kind: "failed", code } } : AGAIN;
}

/** A refusal fails at once; a retry throws until the last attempt, which fails. */
async function unanswered(
  run: Run,
  row: StorePauseRow,
  result: Exclude<OutboundResult, { kind: "accepted" }>,
  codes: { refused: StorePauseFailureCode; unanswered: StorePauseFailureCode },
): Promise<Step> {
  if (result.kind === "refused") return fail(run, row, codes.refused, `${result.status}: ${result.message}`);
  if (run.attempt.attempt < run.attempt.maxAttempts) {
    throw new AvailabilityRetryError(`${row.provider} for ${row.clientId}: ${result.reason}`);
  }
  return fail(run, row, codes.unanswered, result.reason);
}

const PAUSE_CODES = { refused: "PAUSE_REFUSED", unanswered: "PAUSE_UNANSWERED" } as const;
const RESUME_CODES = { refused: "RESUME_REFUSED", unanswered: "RESUME_UNANSWERED" } as const;

/** Whether the marketplace already holds a closure to this end or a later one. */
const upToDate = (row: StorePauseRow): boolean =>
  row.sentUntil !== null && row.until !== null && row.sentUntil.getTime() >= row.until.getTime();

/** The closure the engine holds and still stands: an interruption's id, or a switch it turned off. */
const holds = (row: StorePauseRow): boolean => row.externalId !== null || row.sentUntil !== null;

async function calledSafely<T extends StorePauseResult | OutboundResult>(call: () => Promise<T>): Promise<T | { kind: "retry"; reason: string }> {
  try {
    return await call();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Close the store, or move the end of the closure the engine holds. */
async function sendPause(run: Run, row: StorePauseRow): Promise<Step> {
  const key = row.attemptKey ?? newAttemptKey();
  const request = {
    merchantId: run.merchantId,
    until: row.until as Date,
    reason: row.reason ?? "",
    key,
    timeZone: row.timeZone ?? "UTC",
  };
  const extend = run.availability.extend;
  const ref: StorePauseRef = { merchantId: run.merchantId, externalId: row.externalId, key: null };
  const result = await calledSafely(() =>
    holds(row) && extend ? extend(run.call, ref, request) : run.availability.pause(run.call, request),
  );
  if (result.kind === "refused") {
    // A final refusal created nothing: no key is left in doubt.
    await write(run.ctx, { id: row.id, attemptKey: row.attemptKey }, { attemptKey: null });
    return unanswered(run, row, result, PAUSE_CODES);
  }
  if (result.kind !== "paused") {
    // The key stays on the row: a create whose answer was lost is found under it.
    if (row.attemptKey === null) await write(run.ctx, { id: row.id, attemptKey: null }, { attemptKey: key });
    return unanswered(run, row, result, PAUSE_CODES);
  }
  // A new closure replaced the one the engine held: the old one is deleted next.
  const replaced = row.externalId !== null && result.externalId !== row.externalId;
  await write(
    run.ctx,
    { id: row.id },
    {
      externalId: result.externalId,
      sentUntil: result.until,
      attemptKey: null,
      ...(replaced ? { retiredExternalId: row.externalId } : {}),
    },
  );
  return AGAIN;
}

/** Delete the closure an extend replaced; it ends on its own if this fails, so a failure only logs. */
async function retire(run: Run, row: StorePauseRow, retired: string): Promise<void> {
  const result = await calledSafely(() =>
    run.availability.resume(run.call, { merchantId: run.merchantId, externalId: retired, key: null }),
  );
  if (result.kind === "accepted") {
    await write(run.ctx, { id: row.id, retiredExternalId: retired }, { retiredExternalId: null });
    return;
  }
  run.ctx.ports.logger.warn(
    `marketplace.availability: ${row.provider} for ${row.clientId}: the replaced closure ${retired} was not deleted ` +
      `(${result.kind === "refused" ? `${result.status}: ${result.message}` : result.reason}); the sweep retries it`,
  );
}

async function stepPause(run: Run, row: StorePauseRow): Promise<Step> {
  if (row.until === null) return fail(run, row, "PAUSE_REFUSED", null);
  if (!upToDate(row)) return sendPause(run, row);
  if (row.retiredExternalId !== null) await retire(run, row, row.retiredExternalId);
  await write(
    run.ctx,
    { id: row.id, wanted: "PAUSED", until: row.until },
    { state: "PAUSED", pausedAt: row.pausedAt ?? run.call.now, failureCode: null, failureDetail: null, failedAt: null },
  );
  run.ctx.ports.publishChanged(row.clientId);
  return { settled: true, outcome: { kind: "done", state: "PAUSED" } };
}

/** The next closure of ours to delete, and what deleting it clears; null when nothing of ours stands. */
function nextDelete(row: StorePauseRow, kind: MarketplaceAvailability["kind"]): { ref: StorePauseRef; clear: Record<string, null> } | null {
  const ref = (externalId: string | null, key: string | null) => ({ merchantId: "", externalId, key });
  if (kind === "switch") {
    // A switch has one closure: the store the engine turned off (or may have, while an answer is in doubt).
    if (row.sentUntil === null && row.attemptKey === null) return null;
    return { ref: ref(null, row.attemptKey), clear: { sentUntil: null, attemptKey: null, externalId: null } };
  }
  if (row.externalId !== null) return { ref: ref(row.externalId, null), clear: { externalId: null, sentUntil: null } };
  if (row.retiredExternalId !== null) return { ref: ref(row.retiredExternalId, null), clear: { retiredExternalId: null } };
  if (row.attemptKey !== null) return { ref: ref(null, row.attemptKey), clear: { attemptKey: null, sentUntil: null } };
  return null;
}

async function stepResume(run: Run, row: StorePauseRow): Promise<Step> {
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
  if (result.kind !== "accepted") return unanswered(run, row, result, RESUME_CODES);
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

/** Take the record's lease; false when another run holds it. */
async function lease(ctx: EngineContext, row: StorePauseRow, now: Date): Promise<boolean> {
  const taken = await write(
    ctx,
    { id: row.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    { leaseUntil: new Date(now.getTime() + STORE_PAUSE_LEASE_MS) },
  );
  return taken > 0;
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
  if (row.state === "OPEN" || row.state === "FAILED") return { kind: "skipped", reason: `the record is ${row.state}` };
  const availability = ctx.registry.get(row.provider)?.availability;
  const now = ctx.ports.clock.now();
  if (!availability) {
    await failRow(ctx, now, row, "UNSUPPORTED", null);
    return { kind: "failed", code: "UNSUPPORTED" };
  }
  if (!(await lease(ctx, row, now))) {
    if (attempt.attempt < attempt.maxAttempts) throw new AvailabilityRetryError(`${row.provider} for ${row.clientId}: another run holds it`);
    return { kind: "skipped", reason: "another run holds the record" };
  }
  try {
    const opened = await callContext(ctx, row);
    if (typeof opened === "string") {
      await failRow(ctx, now, row, "NOT_CONNECTED", opened);
      return { kind: "failed", code: "NOT_CONNECTED" };
    }
    return await steps({ ctx, availability, attempt, ...opened }, row);
  } finally {
    await write(ctx, { id: row.id }, { leaseUntil: null });
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
    await failRow(ctx, ctx.ports.clock.now(), row, code, error instanceof Error ? error.message : String(error));
    return { kind: "failed", code };
  }
}
