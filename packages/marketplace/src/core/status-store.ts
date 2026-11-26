import type { StatusStep } from "./adapter";
import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceLifecycle } from "./types";

/**
 * The engine's memory of what was said about an order's steps, in
 * `marketplace_status_updates` (FUT-4653): one row per (order, step), so the
 * same row is the claim that keeps a step from being sent twice, the marker an
 * inbound echo is recognised by, and the note of what the marketplace itself
 * announced. Every function here is a statement or two, never a call out.
 */

/** A step as the table holds it: the three the store informs, and the one only a marketplace announces. */
export type StatusRowStep = StatusStep | MarketplaceLifecycle;

/** Where a row stands. */
export type StatusRowState = "SENDING" | "SENT" | "FAILED" | "NOTED";

/** One row, as the engine reads it. */
export interface StatusRow {
  orderId: string;
  step: StatusRowStep;
  source: "STORE" | "MARKETPLACE";
  state: StatusRowState;
  /** Which run holds a SENDING claim. */
  claimKey: string;
}

type StatusTable = NonNullable<MarketplaceDb["marketplaceStatusUpdate"]>;

/** The status delegate, or null on a host that has not composed the model: the paths that need it then do nothing. */
export function statusTable(db: MarketplaceDb): StatusTable | null {
  return db.marketplaceStatusUpdate ?? null;
}

/** Every row of an order for these steps, in one read. */
export async function readStatusRows(
  table: StatusTable,
  orderId: string,
  steps: readonly StatusRowStep[],
): Promise<StatusRow[]> {
  return (await table.findMany({
    where: { orderId, step: { in: [...steps] } },
    select: { orderId: true, step: true, source: true, state: true, claimKey: true },
  })) as StatusRow[];
}

/**
 * Insert one row. False when the (order, step) row already exists: the unique
 * is the guard and losing it is an answer, not a failure.
 */
export async function insertStatusRow(
  table: StatusTable,
  row: { clientId: string; orderId: string; provider: string; step: StatusRowStep; source: StatusRow["source"]; state: StatusRowState; claimKey: string },
): Promise<boolean> {
  try {
    await table.create({ data: row });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

/** Remember a step the marketplace announced, so our own job never informs it back. */
export async function noteMarketplaceStep(
  ctx: EngineContext,
  row: { clientId: string; orderId: string; provider: string; step: MarketplaceLifecycle },
): Promise<void> {
  const table = statusTable(await ctx.ports.db());
  if (table) await insertStatusRow(table, { ...row, source: "MARKETPLACE", state: "NOTED", claimKey: "" });
}

/**
 * Move a row this run owns from SENDING to its answer; predicated on the state
 * AND the run's claim key, so a settled row is never rewritten and a row
 * another run holds is never settled by this one.
 */
export async function settleStatusRow(
  table: StatusTable,
  where: { orderId: string; step: StatusRowStep; claimKey: string },
  state: "SENT" | "FAILED",
): Promise<number> {
  return (await table.updateMany({ where: { ...where, state: "SENDING" }, data: { state } })).count;
}
