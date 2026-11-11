import type { AcceptanceStatus, CancellationStatus } from "./acceptance";
import type { CancellationReason, MarketplaceAdapter } from "./adapter";
import type { EngineContext } from "./ports";
import { resolveReason } from "./registry";
import type { MarketplaceProvider } from "./types";

/**
 * The store's own CANCELLATION REQUEST — the half of a refusal that must reach
 * the marketplace. Lives on the acceptance row:
 *
 *     null ──refuse/cancel──▶ PENDING ──job 2xx──▶ REQUESTED ──event──▶ CONFIRMED
 *                                │   └──job 4xx / last attempt──▶ FAILED ──event──▶ CONFIRMED
 *                                └──event (the marketplace cancelled)──▶ CONFIRMED
 *
 * CONFIRMED is terminal; every write is predicated on the statuses it may come
 * from, so an out-of-order event cannot undo it.
 */

/** Why a decision (or a store cancellation) was refused. Vocabulary, not copy. */
export type DecisionProblemCode =
  | "DUPLICATE"
  | "NOT_FOUND"
  | "ALREADY_DECIDED"
  | "EXPIRED"
  | "CONFLICT"
  | "INVALID_REASON"
  | "ITEMS_REQUIRED"
  | "UNKNOWN_ITEM"
  | "HOST_REFUSED";

/** One refusal, with the path of the input it is about. Nothing was written. */
export interface DecisionProblem {
  path: (string | number)[];
  code: DecisionProblemCode;
  /** The row's current status, for NOT-pending refusals (ALREADY_DECIDED, EXPIRED). */
  status?: AcceptanceStatus;
  /** The marketplace's codes, for INVALID_REASON. */
  validCodes?: string[];
  /** The host's own refusal, for HOST_REFUSED. */
  host?: { code: string; message: string; details?: unknown };
}

/** The acceptance row a claim reads first. */
export interface ClaimRow {
  orderId: string;
  provider: string;
  status: string;
  cancellationStatus: string | null;
  lineSkus: unknown;
}

export const CLAIM_SELECT = {
  orderId: true,
  provider: true,
  status: true,
  cancellationStatus: true,
  lineSkus: true,
} as const;

/** The refusal a row that is no longer on the clock earns, or null. */
export function notPendingProblem(
  row: ClaimRow | undefined | null,
  path: (string | number)[],
  allowed: readonly string[] = ["AWAITING"],
): DecisionProblem | null {
  if (!row) return { path: [...path, "orderId"], code: "NOT_FOUND" };
  if (allowed.includes(row.status) && row.cancellationStatus === null) return null;
  const status = row.status as AcceptanceStatus;
  return { path: [...path, "orderId"], code: status === "EXPIRED" ? "EXPIRED" : "ALREADY_DECIDED", status };
}

/** What a refusal stamps, and with which reason and SKUs. */
export interface CancellationPlan {
  status: CancellationStatus | null;
  reason: CancellationReason | null;
  skus: string[];
}

function lineSkusOf(row: ClaimRow): Set<string> | null {
  return Array.isArray(row.lineSkus) ? new Set(row.lineSkus.map(String)) : null;
}

/** Every refusal the named SKUs earn: none when the reason needs some, an unknown one. */
function skuProblems(
  reason: CancellationReason | null,
  skus: string[],
  row: ClaimRow,
  path: (string | number)[],
): DecisionProblem[] {
  if (reason?.needsItems && skus.length === 0) return [{ path: [...path, "offendingSkus"], code: "ITEMS_REQUIRED" }];
  const known = lineSkusOf(row);
  // A row from before `line_skus` existed cannot be checked; its SKUs pass.
  if (!known) return [];
  return skus.flatMap((sku, index) =>
    known.has(sku) ? [] : [{ path: [...path, "offendingSkus", index], code: "UNKNOWN_ITEM" as const }],
  );
}

/** The refusal of a named code that is not the marketplace's, or null. */
function invalidReasonProblem(
  adapter: MarketplaceAdapter,
  reason: CancellationReason | null,
  code: string | null | undefined,
  path: (string | number)[],
): DecisionProblem | null {
  if (code === null || code === undefined || reason) return null;
  const validCodes = adapter.cancellationReasons().map((candidate) => candidate.code);
  return { path: [...path, "reasonCode"], code: "INVALID_REASON", validCodes };
}

/**
 * Plan the cancellation half of a refusal, or say what is wrong with it.
 *
 * - No adapter (a provider nobody registers any more): nothing goes out.
 * - The code must be the marketplace's; with none, its first reason is taken.
 * - A reason that `needsItems` needs offending SKUs, each one of the order's.
 * - An API that cannot cancel — at all, or after an accept — stamps FAILED at
 *   once: the request cannot be made from here, and FAILED is what puts the
 *   adapter's app link in front of a person.
 * - Otherwise PENDING, for the outbound job.
 */
export function planCancellation(
  adapter: MarketplaceAdapter | null,
  input: { reasonCode?: string | null; offendingSkus?: readonly string[] },
  row: ClaimRow,
  path: (string | number)[],
): CancellationPlan | DecisionProblem[] {
  if (!adapter) return { status: null, reason: null, skus: [] };
  const reason = resolveReason(adapter, input.reasonCode);
  const invalid = invalidReasonProblem(adapter, reason, input.reasonCode, path);
  if (invalid) return [invalid];
  const skus = [...new Set(input.offendingSkus ?? [])];
  const problems = skuProblems(reason, skus, row, path);
  if (problems.length > 0) return problems;
  const { apiCancel, cancelAfterAccept } = adapter.capabilities;
  const canAsk = apiCancel && reason !== null && (row.status === "AWAITING" || cancelAfterAccept);
  return { status: canAsk ? "PENDING" : "FAILED", reason, skus };
}

/** The columns one refusal writes, from the status it leaves. */
export function refusalData(plan: CancellationPlan, fromStatus: string, now: Date): Record<string, unknown> {
  return {
    status: "REJECTED",
    // An accepted row keeps the instant it was accepted; a row leaving the
    // clock is acknowledged now (the table's CHECK pairs the two).
    ...(fromStatus === "AWAITING" ? { acknowledgedAt: now } : {}),
    cancellationStatus: plan.status,
    cancellationReasonCode: plan.reason?.code ?? null,
    cancellationOffendingSkus: plan.skus.length > 0 ? plan.skus : null,
    cancellationRequestedAt: plan.status === "PENDING" ? now : null,
  };
}

/**
 * The marketplace refused the store's cancellation request. FAILED, from
 * PENDING or REQUESTED only: CONFIRMED is terminal, so a refusal arriving
 * after the cancellation changes nothing. Returns whether a row moved.
 */
export async function failCancellationRequest(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; externalOrderId: string },
): Promise<boolean> {
  const db = await ctx.ports.db();
  const moved = await db.marketplaceAcceptance.updateMany({
    where: {
      clientId: input.clientId,
      provider: input.provider,
      externalOrderId: input.externalOrderId,
      cancellationStatus: { in: ["PENDING", "REQUESTED"] },
    },
    data: { cancellationStatus: "FAILED" },
  });
  if (moved.count > 0) ctx.ports.publishChanged(input.clientId);
  return moved.count > 0;
}
