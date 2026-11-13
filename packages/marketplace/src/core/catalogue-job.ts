import type { OutboundResult } from "./adapter";
import type { CatalogueCallContext, CatalogueFailure, CataloguePublishResult, MarketplaceCatalogue } from "./catalogue-port";
import {
  CATALOGUE_ROW_SELECT,
  NO_FAILURE,
  catalogueConnection,
  catalogueTable,
  truncateReason,
  type CatalogueFailureCode,
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
  /** `reason` is the row's failure code; the detail went to the log. */
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

/** What a run did instead of a call: an engine-side reason it cannot be made. */
type Run = { result: RunResult; sentPriceCents: number | null; name?: string } | { code: CatalogueFailureCode };

/** The call this run makes, or the code that stands in for it. */
async function callFor(
  ctx: EngineContext,
  row: CatalogueRow,
  action: CatalogueAction,
  catalogue: MarketplaceCatalogue,
  call: CatalogueCallContext,
): Promise<Run> {
  if (action === "withdraw") {
    if (catalogue.mode === "pull") return { result: await catalogue.notifyMenuChanged(call), sentPriceCents: null };
    const ref = { ref: row.id, productId: row.productId, externalId: row.externalId };
    return { result: await catalogue.withdrawItem(call, ref), sentPriceCents: null };
  }
  const item = (await ctx.ports.catalogue?.items(row.clientId, [row.productId]))?.get(row.productId);
  if (!item) return { code: "PRODUCT_GONE" };
  const priceCents = row.priceCents ?? item.priceCents;
  if (catalogue.mode === "pull") {
    return { result: await catalogue.notifyMenuChanged(call), sentPriceCents: priceCents, name: item.name };
  }
  const storedImage = row.imageRef && row.imageSourceUrl ? { ref: row.imageRef, sourceUrl: row.imageSourceUrl } : null;
  const out = { ...item, priceCents, ref: row.id, productId: row.productId, externalId: row.externalId, storedImage };
  return { result: await catalogue.publishItem(call, out), sentPriceCents: priceCents, name: item.name };
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

/**
 * A withdraw that landed after the store switched the product back on (a
 * publish while withdrawing): the item is out on the marketplace now, so the
 * publish is owed again, whether or not its own run already went out. The row
 * takes a fresh ask and the publish is queued: the store's last tap wins.
 */
async function publishLateLanding(ctx: EngineContext, table: CatalogueTable, row: CatalogueRow): Promise<void> {
  const now = ctx.ports.clock.now();
  const moved = await table.updateMany({
    where: { id: row.id, status: { in: ["PUBLISHING", "PUBLISHED"] } },
    data: { status: "PUBLISHING", requestedAt: now },
  });
  if (moved.count === 0) return;
  const payload: CatalogueJobPayload = { clientId: row.clientId, publicationId: row.id, action: "publish" };
  await enqueueCatalogue(ctx, payload, catalogueDedupeKey(payload, now));
}

/**
 * Map the SKU the marketplace's orders will carry for a published item to the
 * host's product, so those orders arrive mapped instead of on the attention
 * list. Kept on a withdraw: an order placed before it still maps.
 */
async function mapPublishedSku(ctx: EngineContext, row: CatalogueRow, result: RunResult, name: string | undefined): Promise<void> {
  const sku = (result.kind === "published" ? result.sku : undefined) ?? row.productId;
  const db = await ctx.ports.db();
  await db.marketplaceMenuLink.upsert({
    where: { clientId_provider_externalSku: { clientId: row.clientId, provider: row.provider, externalSku: sku } },
    create: {
      clientId: row.clientId,
      provider: row.provider,
      externalSku: sku,
      externalName: name ?? null,
      menuItemId: row.productId,
      lastSeenAt: ctx.ports.clock.now(),
    },
    update: { menuItemId: row.productId },
  });
}

/** What a successful publish leaves on the row beyond its state: the item's id, the photo held, the warning. */
function publishedExtras(result: RunResult): Record<string, unknown> {
  if (result.kind !== "published") return { warningCode: null };
  const image =
    result.image === undefined
      ? {}
      : { imageRef: result.image?.ref ?? null, imageSourceUrl: result.image?.sourceUrl ?? null };
  return { externalId: result.externalId, warningCode: result.warning ?? null, ...image };
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
  const data =
    action === "publish"
      ? { status: "PUBLISHED", publishedAt: now, sentPriceCents, ...publishedExtras(result), ...NO_FAILURE }
      : { status: "WITHDRAWN", withdrawnAt: now, ...NO_FAILURE };
  const moved = await table.updateMany({ where: stillAsked(row, action), data });
  if (moved.count > 0) return;
  if (action === "publish") await withdrawLateLanding(ctx, table, row, externalId);
  else await publishLateLanding(ctx, table, row);
}

/** One failure, as the row keeps it: a code, and the marketplace's own words only for a refusal. */
interface Failure {
  code: CatalogueFailureCode;
  reason: string | null;
}

async function stampFailure(table: CatalogueTable, row: CatalogueRow, action: CatalogueAction, failure: Failure, now: Date): Promise<void> {
  await table.updateMany({
    where: stillAsked(row, action),
    data: {
      status: "FAILED",
      failedAction: action === "publish" ? "PUBLISH" : "WITHDRAW",
      failureCode: failure.code,
      failureReason: failure.reason === null ? null : truncateReason(failure.reason),
      failedAt: now,
    },
  });
}

/** A final answer as the row keeps it: the marketplace's refusal with its words, or UNAVAILABLE. */
function failureOf(result: CatalogueFailure): Failure {
  if (result.kind === "retry") return { code: "UNAVAILABLE", reason: null };
  return { code: "REFUSED", reason: result.message === "" ? null : result.message };
}

/** The run this row gets: the adapter's call, or the code that stands in for it. */
async function runFor(ctx: EngineContext, row: CatalogueRow, action: CatalogueAction): Promise<Run> {
  const catalogue = ctx.registry.get(row.provider)?.catalogue;
  if (!catalogue) return { code: "UNSUPPORTED" };
  const connection = await catalogueConnection(ctx, row.clientId, row.provider);
  if ("problem" in connection) return { code: connection.problem };
  return callFor(ctx, row, action, catalogue, { ...connection, now: ctx.ports.clock.now() });
}

async function fail(ctx: EngineContext, table: CatalogueTable, row: CatalogueRow, action: CatalogueAction, failure: Failure, detail: string) {
  await stampFailure(table, row, action, failure, ctx.ports.clock.now());
  ctx.ports.logger.error(`${MARKETPLACE_CATALOGUE_JOB}: ${action} of ${row.productId} on ${row.provider} failed (${failure.code}): ${detail}`);
  ctx.ports.publishChanged(row.clientId);
  return { kind: "failed" as const, action, reason: failure.code };
}

async function runOnce(
  ctx: EngineContext,
  table: CatalogueTable,
  payload: CatalogueJobPayload,
  attempt: { attempt: number; maxAttempts: number },
): Promise<CatalogueOutcome> {
  const row = await readRow(table, payload);
  if (!row) return { kind: "skipped", reason: "no such publication for this tenant" };
  const { action } = payload;
  if (row.status !== WANTED[action]) return { kind: "skipped", reason: `the publication is ${row.status}, not ${WANTED[action]}` };
  let run = await runFor(ctx, row, action);
  // A withdraw for a connection that is gone (archived, removed) has nobody to tell: it is out.
  if ("code" in run && run.code === "NOT_CONNECTED" && action === "withdraw") run = { result: { kind: "accepted" }, sentPriceCents: null };
  if ("code" in run) return fail(ctx, table, row, action, { code: run.code, reason: null }, run.code);
  const { result } = run;
  if (result.kind === "accepted" || result.kind === "published") {
    await stampSuccess(ctx, table, row, action, result, run.sentPriceCents);
    if (action === "publish") await mapPublishedSku(ctx, row, result, run.name);
    ctx.ports.publishChanged(row.clientId);
    return { kind: "done", action };
  }
  const detail = result.kind === "retry" ? result.reason : `refused ${result.status}: ${result.message}`;
  if (result.kind === "retry" && attempt.attempt < attempt.maxAttempts) {
    throw new CatalogueRetryError(`${action} of ${row.productId} on ${row.provider}: ${detail}`);
  }
  return fail(ctx, table, row, action, failureOf(result), detail);
}

function readRow(table: CatalogueTable, payload: CatalogueJobPayload): Promise<CatalogueRow | null> {
  return table.findFirst({
    where: { id: payload.publicationId, clientId: payload.clientId },
    select: CATALOGUE_ROW_SELECT,
  }) as Promise<CatalogueRow | null>;
}

/**
 * Run one queued catalogue call. Throws {@link CatalogueRetryError} for an
 * answer worth retrying before the last attempt; any other throw is rethrown
 * for the queue to retry, and on the last attempt ends FAILED, INTERNAL (the
 * message is logged, never stored).
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
    const detail = error instanceof Error ? error.message : String(error);
    const row = await readRow(table, payload);
    if (row && row.status === WANTED[payload.action]) return fail(ctx, table, row, payload.action, { code: "INTERNAL", reason: null }, detail);
    ctx.ports.logger.error(`${MARKETPLACE_CATALOGUE_JOB}: ${payload.action} of ${payload.publicationId} failed: ${detail}`);
    return { kind: "failed", action: payload.action, reason: "INTERNAL" };
  }
}
