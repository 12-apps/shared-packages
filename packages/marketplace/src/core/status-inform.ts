import type { StatusStep } from "./adapter";
import { MARKETPLACE_OUTBOUND_JOB, statusDedupeKey } from "./outbound-queue";
import type { EngineContext } from "./ports";

/** What the host says when a pedido reaches a step (FUT-4653). */
export interface InformStatusInput {
  clientId: string;
  /** The host's order id. */
  orderId: string;
  step: StatusStep;
  /**
   * The instant of the move (the card's own timestamp), which makes the job's
   * key: a re-dispatch after an undo is another instant, and a queue keeps a
   * finished job's id and would swallow the same key.
   */
  at: Date;
  /** OPTIONAL. Run the job this much later: the board's undo window for a dispatch. */
  delayMs?: number;
}

/**
 * One enqueue and nothing else: no statement, no call to a marketplace, no
 * provider lookup (the host knows the pedido is a marketplace's, not whose).
 * The job asks the adapter whether it takes the step. A refused or throwing
 * queue is logged and answers false; nothing owed is recorded, so nothing is
 * re-queued (no row exists before the job, and writing one in the host's tap
 * would cost a statement on every move).
 */
export async function informStatus(ctx: EngineContext, input: InformStatusInput): Promise<boolean> {
  const payload = { clientId: input.clientId, orderId: input.orderId, action: "status" as const, step: input.step };
  const options = {
    dedupeKey: statusDedupeKey(input.step, input.orderId, input.at),
    ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
  };
  try {
    const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_OUTBOUND_JOB, payload, options);
    if (!outcome.enqueued) {
      ctx.ports.logger.warn(
        `${MARKETPLACE_OUTBOUND_JOB}: status ${input.step} for order ${input.orderId} was not queued` +
          (outcome.reason ? ` (${outcome.reason})` : ""),
      );
    }
    return outcome.enqueued;
  } catch (error) {
    ctx.ports.logger.warn(
      `${MARKETPLACE_OUTBOUND_JOB}: status ${input.step} for order ${input.orderId} was not queued: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return false;
  }
}
