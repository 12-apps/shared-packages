import type { AcceptanceStatus, CancellationStatus } from "./acceptance";
import {
  CLAIM_SELECT,
  NO_STANDING_REQUEST,
  notPendingProblem,
  planCancellation,
  refusalData,
  requestData,
  type CancellationPlan,
  type ClaimRow,
  type DecisionProblem,
  type DecisionProblemCode,
} from "./cancellation";
import { enqueueOutbound } from "./outbound-queue";
import type { EngineContext, MarketplaceAdmission, MarketplaceDb } from "./ports";

/**
 * The store's decisions on orders on the clock — ONE path for every surface
 * (the host's board, the admin route, the MCP tool), and all-or-nothing:
 *
 * 1. every decision is validated against its row (still AWAITING, the reason
 *    the marketplace's, the offending SKUs the order's) before anything runs;
 * 2. inside ONE transaction the host ADMITS each decision (`order.admit`: the
 *    stock ask, the draw) and the engine claims each row on `AWAITING`. A
 *    host refusal or a lost claim rolls the whole call back;
 * 3. after the commit, each outbound call is QUEUED FIRST, then the host's
 *    half runs (`onAccepted` / `onRefused`). A host half that throws cannot
 *    lose the call; it is logged, and the decision stands.
 *
 * A queue that refuses the job loses nothing either: the outbound sweep
 * (`./outbound-sweep.ts`) re-queues every request still owed.
 */

/** The two things a person can do to an order on the clock. */
export type AcceptanceDecision = "ACCEPT" | "REJECT";

/** One decision, as a caller states it. */
export type DecisionInput =
  | {
      orderId: string;
      decision: "ACCEPT";
      /** What the person confirmed, for the host's admission. */
      admission?: MarketplaceAdmission;
      /** Minutes to prepare, for a marketplace whose confirm states one. */
      preparationMinutes?: number | null;
    }
  | {
      orderId: string;
      decision: "REJECT";
      /** One of the marketplace's codes; its first reason when absent. */
      reasonCode?: string | null;
      /** The order's SKUs a reason that `needsItems` names. */
      offendingSkus?: readonly string[];
    };

/** One decided row. */
export interface DecidedRow {
  orderId: string;
  status: Extract<AcceptanceStatus, "ACCEPTED" | "REJECTED">;
  cancellation: CancellationStatus | null;
  reasonCode: string | null;
  offendingSkus: string[];
}

/** What a call did: every row decided, or nothing written and every problem named. */
export type DecideManyResult =
  | { kind: "decided"; validateOnly: boolean; rows: DecidedRow[] }
  | { kind: "refused"; problems: DecisionProblem[] };

/** One decision's result, for a caller deciding one order. */
export type DecisionResult =
  | ({ kind: "decided" } & DecidedRow)
  | {
      kind: "stale";
      /** Why: gone, decided already (I4: answer it as done), expired, or lost to a race. */
      reason: Extract<DecisionProblemCode, "NOT_FOUND" | "ALREADY_DECIDED" | "EXPIRED" | "CONFLICT">;
      status: AcceptanceStatus | null;
    }
  | {
      kind: "invalidReason";
      problem: Extract<DecisionProblemCode, "INVALID_REASON" | "ITEMS_REQUIRED" | "UNKNOWN_ITEM">;
      validCodes: string[];
    }
  | { kind: "refusedByHost"; code: string; message: string; details?: unknown };

/** A planned decision: the row, the claim's data, and what it becomes. */
interface PlannedDecision {
  input: DecisionInput;
  index: number;
  row: ClaimRow;
  data: Record<string, unknown>;
  decided: DecidedRow;
}

/** Thrown inside the transaction to roll it back, carrying the reason. */
class Rollback extends Error {
  constructor(readonly problems: DecisionProblem[] | null) {
    super("rollback");
  }
}

function duplicateProblems(decisions: readonly DecisionInput[]): DecisionProblem[] {
  const seen = new Set<string>();
  return decisions.flatMap((decision, index) => {
    if (!seen.has(decision.orderId)) {
      seen.add(decision.orderId);
      return [];
    }
    return [{ path: ["decisions", index, "orderId"], code: "DUPLICATE" as const }];
  });
}

function decidedOf(input: DecisionInput, plan: CancellationPlan | null): DecidedRow {
  return {
    orderId: input.orderId,
    status: input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
    cancellation: plan?.status ?? null,
    reasonCode: plan?.reason?.code ?? null,
    offendingSkus: plan?.skus ?? [],
  };
}

/** Plan one decision against its row, or name what is wrong with it. */
/** The columns of a request that no longer stands, cleared. */
const CLEARED_REQUEST = {
  cancellationStatus: null,
  cancellationReasonCode: null,
  cancellationOffendingSkus: null,
  cancellationRequestedAt: null,
  cancellationFailureReason: null,
} as const;

function planOne(
  ctx: EngineContext,
  input: DecisionInput,
  index: number,
  row: ClaimRow | undefined,
  now: Date,
): PlannedDecision | DecisionProblem[] {
  const path = ["decisions", index];
  const stale = notPendingProblem(row, path);
  if (stale || !row) return stale ? [stale] : [];
  if (input.decision === "ACCEPT") {
    // An accept after a FAILED request (FUT-4758) leaves no request behind it.
    const data = {
      status: "ACCEPTED",
      acknowledgedAt: now,
      preparationMinutes: input.preparationMinutes ?? null,
      ...(row.cancellationStatus === null ? {} : CLEARED_REQUEST),
    };
    return { input, index, row, data, decided: decidedOf(input, null) };
  }
  const plan = planCancellation(ctx.registry.get(row.provider), input, row, path);
  if (Array.isArray(plan)) return plan;
  return { input, index, row, data: refusalData(plan, row.status, now), decided: decidedOf(input, plan) };
}

/** Admit every decision through the host, then claim every row, in one transaction. */
async function admitAndClaim(
  ctx: EngineContext,
  clientId: string,
  planned: readonly PlannedDecision[],
  validateOnly: boolean,
): Promise<void> {
  await ctx.ports.transaction(async (tx: MarketplaceDb) => {
    const refused: DecisionProblem[] = [];
    for (const one of planned) {
      const admission = one.input.decision === "ACCEPT" ? (one.input.admission ?? {}) : {};
      const answer = await ctx.ports.order.admit({
        clientId,
        orderId: one.input.orderId,
        decision: one.input.decision,
        admission,
        db: tx,
      });
      if (!answer.admitted) {
        const host = { code: answer.code, message: answer.message, details: answer.details };
        refused.push({ path: ["decisions", one.index], code: "HOST_REFUSED", host });
      }
    }
    if (refused.length > 0) throw new Rollback(refused);
    for (const one of planned) {
      const claimed = await tx.marketplaceAcceptance.updateMany({
        where: { orderId: one.input.orderId, clientId, status: "AWAITING", ...NO_STANDING_REQUEST },
        data: one.data,
      });
      if (claimed.count === 0) refused.push({ path: ["decisions", one.index, "orderId"], code: "CONFLICT" });
    }
    if (refused.length > 0) throw new Rollback(refused);
    if (validateOnly) throw new Rollback(null);
  });
}

/** After the commit: queue each owed call FIRST, then the host's half, which may not lose it. */
async function afterCommit(ctx: EngineContext, clientId: string, planned: readonly PlannedDecision[]): Promise<void> {
  for (const one of planned) {
    const { orderId } = one.input;
    if (one.decided.status === "ACCEPTED") {
      await enqueueOutbound(ctx, { clientId, orderId, action: "confirm" }, one.row.provider);
    } else if (one.decided.cancellation === "PENDING") {
      await enqueueOutbound(ctx, { clientId, orderId, action: "requestCancellation" }, one.row.provider);
    }
    try {
      if (one.decided.status === "ACCEPTED") await ctx.ports.order.onAccepted(clientId, orderId);
      else await ctx.ports.order.onRefused(clientId, orderId, "REJECTED");
    } catch (error) {
      ctx.ports.logger.error(
        `marketplace.decide: order ${orderId} is ${one.decided.status} but the host's half failed: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  ctx.ports.publishChanged(clientId);
}

/** Read every row a call names, in one statement. */
async function readRows(ctx: EngineContext, clientId: string, orderIds: string[]): Promise<Map<string, ClaimRow>> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceAcceptance.findMany({
    where: { clientId, orderId: { in: orderIds } },
    select: CLAIM_SELECT,
  })) as ClaimRow[];
  return new Map(rows.map((row) => [row.orderId, row]));
}

/**
 * Decide many orders at once, all-or-nothing. `validateOnly` runs everything —
 * the host's admission included — and rolls it back.
 */
export async function decideMany(
  ctx: EngineContext,
  input: { clientId: string; decisions: readonly DecisionInput[]; validateOnly?: boolean; now?: Date },
): Promise<DecideManyResult> {
  const duplicates = duplicateProblems(input.decisions);
  if (duplicates.length > 0) return { kind: "refused", problems: duplicates };
  const now = input.now ?? ctx.ports.clock.now();
  const rows = await readRows(ctx, input.clientId, input.decisions.map((decision) => decision.orderId));

  const planned: PlannedDecision[] = [];
  const problems: DecisionProblem[] = [];
  input.decisions.forEach((decision, index) => {
    const plan = planOne(ctx, decision, index, rows.get(decision.orderId), now);
    if (Array.isArray(plan)) problems.push(...plan);
    else planned.push(plan);
  });
  if (problems.length > 0) return { kind: "refused", problems };

  const validateOnly = input.validateOnly === true;
  try {
    await admitAndClaim(ctx, input.clientId, planned, validateOnly);
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    if (error.problems) return { kind: "refused", problems: error.problems };
  }
  if (!validateOnly) await afterCommit(ctx, input.clientId, planned);
  return { kind: "decided", validateOnly, rows: planned.map((one) => one.decided) };
}

const STALE_CODES = new Set<DecisionProblemCode>(["NOT_FOUND", "ALREADY_DECIDED", "EXPIRED", "CONFLICT"]);

/** One decision's problem, as the single-order result names it. */
function resultOfProblem(problem: DecisionProblem): DecisionResult {
  if (problem.code === "HOST_REFUSED") {
    const host = problem.host ?? { code: "", message: "" };
    return { kind: "refusedByHost", code: host.code, message: host.message, details: host.details };
  }
  if (STALE_CODES.has(problem.code)) {
    const reason = problem.code as Extract<DecisionResult, { kind: "stale" }>["reason"];
    return { kind: "stale", reason, status: problem.status ?? null };
  }
  const invalid = problem.code as Extract<DecisionResult, { kind: "invalidReason" }>["problem"];
  return { kind: "invalidReason", problem: invalid, validCodes: problem.validCodes ?? [] };
}

/** Decide ONE order: `decideMany` with one decision. */
export async function decideOne(
  ctx: EngineContext,
  input: { clientId: string; now?: Date } & DecisionInput,
): Promise<DecisionResult> {
  const { clientId, now, ...decision } = input;
  const result = await decideMany(ctx, { clientId, decisions: [decision as DecisionInput], now });
  if (result.kind === "decided") {
    const [row] = result.rows;
    if (row) return { kind: "decided", ...row };
  }
  const [problem] = result.kind === "refused" ? result.problems : [];
  return problem ? resultOfProblem(problem) : { kind: "stale", reason: "CONFLICT", status: null };
}

/**
 * The STORE asks to cancel an order — before or after accepting it. Stamps
 * the request the marketplace must hear and queues it; the engine neither
 * admits nor calls `onRefused`: it records and queues, and nothing else.
 *
 * REQUEST FIRST (FUT-4758): only the request moves. The decision status stays
 * AWAITING or ACCEPTED while the marketplace answers, so a host that cancels
 * on `onCancellationConfirmed` keeps the order as it was until then, and a
 * refused or timed-out request (`onCancellationFailed`) leaves it acceptable
 * and still on the acceptance clock. The marketplace's confirmation moves it
 * to REJECTED. (1.0.0 stamped REJECTED here; its hosts cancelled first and
 * never read the status back.) A FAILED request may be asked again.
 *
 * The returned row's `status` is the decision taken, REJECT, not the row's.
 *
 * `stale` (ALREADY_DECIDED) when the marketplace already cancelled it, the
 * clock lapsed (EXPIRED), or a request is already waiting.
 */
export async function recordStoreCancellation(
  ctx: EngineContext,
  input: { clientId: string; orderId: string; reasonCode?: string | null; offendingSkus?: readonly string[]; now?: Date },
): Promise<DecisionResult> {
  const row = (await readRows(ctx, input.clientId, [input.orderId])).get(input.orderId);
  const stale = notPendingProblem(row, [], ["AWAITING", "ACCEPTED"]);
  if (stale || !row) return stale ? resultOfProblem(stale) : { kind: "stale", reason: "NOT_FOUND", status: null };
  const plan = planCancellation(ctx.registry.get(row.provider), input, row, []);
  if (Array.isArray(plan)) return resultOfProblem(plan[0]!);

  const now = input.now ?? ctx.ports.clock.now();
  const db = await ctx.ports.db();
  const claimed = await db.marketplaceAcceptance.updateMany({
    where: { orderId: input.orderId, clientId: input.clientId, status: row.status, ...NO_STANDING_REQUEST },
    data: requestData(plan, now),
  });
  if (claimed.count === 0) return { kind: "stale", reason: "CONFLICT", status: null };
  if (plan.status === "PENDING") {
    await enqueueOutbound(ctx, { clientId: input.clientId, orderId: input.orderId, action: "requestCancellation" }, row.provider);
  }
  ctx.ports.publishChanged(input.clientId);
  return { kind: "decided", ...decidedOf({ orderId: input.orderId, decision: "REJECT" }, plan) };
}
