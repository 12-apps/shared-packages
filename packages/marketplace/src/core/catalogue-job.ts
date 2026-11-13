import type { OutboundResult } from "./adapter";
import type { CatalogueCallContext, CataloguePublishResult, MarketplaceCatalogue } from "./catalogue-port";
import {
  CATALOGUE_ROW_SELECT,
  catalogueConnection,
  catalogueTable,
  truncateReason,
  type CatalogueRow,
  type CatalogueTable,
} from "./catalogue-store";
import type { EngineContext } from "./ports";

/**
 * The catalogue job (`marketplace.catalogue`): one publish or withdraw of one
 * product on one marketplace, start to finish (FUT-4768).
 *
 * The same rules as the outbound job, for the same reasons:
 *
 * - **idempotent by the ROW** — a run acts only while the row still asks for
 *   its action (PUBLISHING for a publish, WITHDRAWING for a withdraw) at the
 *   instant it was asked (`requested_at`), so a duplicate or stale job calls
 *   nobody, and a stamp never overwrites a newer ask;
 * - **2xx done, a final 4xx FAILED with the marketplace's reason, anything
 *   else retried** until the last attempt, which ends FAILED;
 * - **queued, never called inline** — `publish` and `withdraw` only stamp and
 *   enqueue; the sweep re-queues a row still owed.
 *
 * Push or pull is the adapter's `catalogue.mode`, never a provider check: a
 * push marketplace gets the item written or withdrawn; a pull marketplace is
 * told its menu changed (the host serves the document, which already reflects
 * the row).
 */

/** The wire name, `<namespace>.<blueprint>` as the jobs contribution binds it. */
export const MARKETPLACE_CATALOGUE_JOB = "marketplace.catalogue";

/** What one run does to its row. */
export type CatalogueAction = "publish" | "withdraw";

/** The job's payload. Identifiers only: what to send lives on the row and in the host's catalogue. */
export interface CatalogueJobPayload {
  clientId: string;
  publicationId: string;
  action: CatalogueAction;
}

/** What one run did. */
export type CatalogueOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "done"; action: CatalogueAction }
  | { kind: "failed"; action: CatalogueAction; reason: string };

/** Thrown so the queue retries. Its message is what the job log reads. */
export class CatalogueRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueRetryError";
  }
}

const WANTED: Record<CatalogueAction, string> = { publish: "PUBLISHING", withdraw: "WITHDRAWING" };

/** The dedupe key: one queued run per (row, ask). A re-ask carries a new instant, so it is never swallowed. */
export function catalogueDedupeKey(payload: CatalogueJobPayload, requestedAt: Date): string {
  return `${MARKETPLACE_CATALOGUE_JOB}:${payload.action}:${payload.publicationId}:${requestedAt.getTime()}`;
}

/** Queue one run. The queue port never throws; a refusal is logged, and the sweep re-queues the row. */
export async function enqueueCatalogue(ctx: EngineContext, payload: CatalogueJobPayload, dedupeKey: string): Promise<void> {
  const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_CATALOGUE_JOB, payload, { dedupeKey });
  if (outcome.enqueued) return;
  ctx.ports.logger.warn(
    `${MARKETPLACE_CATALOGUE_JOB}: ${payload.action} of ${payload.publicationId} was not queued; the outbound sweep will re-queue it` +
      (outcome.reason ? ` (${outcome.reason})` : ""),
  );
}

type RunResult = CataloguePublishResult | OutboundResult;

/** The call this run makes, or the refusal that stands in for it. */
async function callFor(
  ctx: EngineContext,
  row: CatalogueRow,
  action: CatalogueAction,
  catalogue: MarketplaceCatalogue,
  call: CatalogueCallContext,
): Promise<{ result: RunResult; sentPriceCents: number | null }> {
  const refused = (message: string) => ({ result: { kind: "refused", status: 0, message } as const, sentPriceCents: null });
  if (action === "withdraw") {
    if (catalogue.mode === "pull") return { result: await catalogue.notifyMenuChanged(call), sentPriceCents: null };
    const ref = { ref: row.id, productId: row.productId, externalId: row.externalId };
    return { result: await catalogue.withdrawItem(call, ref), sentPriceCents: null };
  }
  const item = (await ctx.ports.catalogue?.items(row.clientId, [row.productId]))?.get(row.productId);
  if (!item) return refused("the product no longer exists in the store's catalogue");
  const priceCents = row.priceCents ?? item.priceCents;
  if (catalogue.mode === "pull") return { result: await catalogue.notifyMenuChanged(call), sentPriceCents: priceCents };
  const out = { ...item, priceCents, ref: row.id, productId: row.productId, externalId: row.externalId };
  return { result: await catalogue.publishItem(call, out), sentPriceCents: priceCents };
}

/** The predicate a stamp holds to: the row still asks for this action, at the instant this run read. */
const stillAsked = (row: CatalogueRow, action: CatalogueAction) => ({
  id: row.id,
  status: WANTED[action],
  requestedAt: row.requestedAt,
});

/**
 * A publish that landed after the store asked for the product out (a withdraw
 * while publishing): the item is on the marketplace now, so the withdraw is
 * owed again. The row goes back to WITHDRAWING with a fresh ask, carrying the
 * id the publish answered, and the withdraw is queued.
 */
async function withdrawLateLanding(ctx: EngineContext, table: CatalogueTable, row: CatalogueRow, externalId: string | null): Promise<void> {
  const now = ctx.ports.clock.now();
  const moved = await table.updateMany({
    where: { id: row.id, status: { in: ["WITHDRAWING", "WITHDRAWN"] } },
    data: { status: "WITHDRAWING", requestedAt: now, ...(externalId === null ? {} : { externalId }) },
  });
  if (moved.count === 0) return;
  const payload: CatalogueJobPayload = { clientId: row.clientId, publicationId: row.id, action: "withdraw" };
  await enqueueCatalogue(ctx, payload, catalogueDedupeKey(payload, now));
}

async function stampSuccess(
  ctx: EngineContext,
  table: CatalogueTable,
  row: CatalogueRow,
  action: CatalogueAction,
  result: RunResult,
  sentPriceCents: number | null,
): Promise<void> {
  const now = ctx.ports.clock.now();
  const externalId = result.kind === "published" ? result.externalId : null;
  const failure = { failedAction: null, failureReason: null, failedAt: null };
  const data =
    action === "publish"
      ? { status: "PUBLISHED", publishedAt: now, sentPriceCents, ...(externalId === null ? {} : { externalId }), ...failure }
      : { status: "WITHDRAWN", withdrawnAt: now, ...failure };
  const moved = await table.updateMany({ where: stillAsked(row, action), data });
  if (moved.count === 0 && action === "publish") await withdrawLateLanding(ctx, table, row, externalId);
}

async function stampFailure(table: CatalogueTable, row: CatalogueRow, action: CatalogueAction, reason: string, now: Date): Promise<void> {
  await table.updateMany({
    where: stillAsked(row, action),
    data: {
      status: "FAILED",
      failedAction: action === "publish" ? "PUBLISH" : "WITHDRAW",
      failureReason: truncateReason(reason),
      failedAt: now,
    },
  });
}

/** The marketplace's own words for a refusal: its message, else its status. */
function reasonOf(result: Exclude<RunResult, { kind: "accepted" } | { kind: "published" }>): string {
  if (result.kind === "retry") return result.reason;
  return result.message === "" ? `refused ${result.status}` : result.message;
}

async function runOnce(
  ctx: EngineContext,
  table: CatalogueTable,
  payload: CatalogueJobPayload,
  attempt: { attempt: number; maxAttempts: number },
): Promise<CatalogueOutcome> {
  const row = (await table.findFirst({
    where: { id: payload.publicationId, clientId: payload.clientId },
    select: CATALOGUE_ROW_SELECT,
  })) as CatalogueRow | null;
  if (!row) return { kind: "skipped", reason: "no such publication for this tenant" };
  const { action } = payload;
  if (row.status !== WANTED[action]) return { kind: "skipped", reason: `the publication is ${row.status}, not ${WANTED[action]}` };
  const catalogue = ctx.registry.get(row.provider)?.catalogue;
  const connection = await catalogueConnection(ctx, row.clientId, row.provider);
  let run: { result: RunResult; sentPriceCents: number | null };
  if (!catalogue) run = { result: { kind: "refused", status: 0, message: `${row.provider} has no catalogue` }, sentPriceCents: null };
  else if (typeof connection === "string") run = { result: { kind: "refused", status: 0, message: connection }, sentPriceCents: null };
  else run = await callFor(ctx, row, action, catalogue, { ...connection, now: ctx.ports.clock.now() });
  const { result } = run;
  if (result.kind === "accepted" || result.kind === "published") {
    await stampSuccess(ctx, table, row, action, result, run.sentPriceCents);
    ctx.ports.publishChanged(row.clientId);
    return { kind: "done", action };
  }
  const reason = reasonOf(result);
  if (result.kind === "retry" && attempt.attempt < attempt.maxAttempts) {
    throw new CatalogueRetryError(`${action} of ${row.productId} on ${row.provider}: ${reason}`);
  }
  await stampFailure(table, row, action, reason, ctx.ports.clock.now());
  ctx.ports.logger.error(`${MARKETPLACE_CATALOGUE_JOB}: ${action} of ${row.productId} on ${row.provider} failed: ${reason}`);
  ctx.ports.publishChanged(row.clientId);
  return { kind: "failed", action, reason };
}

/**
 * Run one queued catalogue call. Throws {@link CatalogueRetryError} for an
 * answer worth retrying before the last attempt; any other throw is rethrown
 * for the queue to retry, and on the last attempt ends FAILED.
 */
export async function runCatalogue(
  ctx: EngineContext,
  payload: CatalogueJobPayload,
  attempt: { attempt: number; maxAttempts: number },
): Promise<CatalogueOutcome> {
  const table = await catalogueTable(ctx);
  if (!table) return { kind: "skipped", reason: "the host has no catalogue table" };
  try {
    return await runOnce(ctx, table, payload, attempt);
  } catch (error) {
    if (error instanceof CatalogueRetryError || attempt.attempt < attempt.maxAttempts) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const row = (await table.findFirst({
      where: { id: payload.publicationId, clientId: payload.clientId },
      select: CATALOGUE_ROW_SELECT,
    })) as CatalogueRow | null;
    if (row && row.status === WANTED[payload.action]) await stampFailure(table, row, payload.action, reason, ctx.ports.clock.now());
    ctx.ports.logger.error(`${MARKETPLACE_CATALOGUE_JOB}: ${payload.action} of ${payload.publicationId} failed: ${reason}`);
    ctx.ports.publishChanged(payload.clientId);
    return { kind: "failed", action: payload.action, reason };
  }
}
