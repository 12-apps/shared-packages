import type { MarketplaceAdapter } from "./adapter";
import type { CancellationFailureReason, EngineContext } from "./ports";

/**
 * How the store's own cancellation request ENDS, told to the host (FUT-4758).
 *
 * A host that requests first and cancels only on the marketplace's answer
 * needs both ends: the confirmation, to run its cancel, and the failure, to
 * put the pedido back in a person's hands. Both are optional order-port
 * callbacks, so a 1.0.0 host compiles and behaves unchanged. Each is called by
 * whichever path moved the row (the outbound job, the marketplace's event, the
 * sweep's expiry), once, and a host failure is logged, never rethrown: the
 * row's stamp has committed, and a host that fails its half must not undo it.
 */

async function tell(ctx: EngineContext, what: string, orderId: string, call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    ctx.ports.logger.error(
      `marketplace.cancellation: order ${orderId} ${what} but the host's half failed: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** The marketplace confirmed the store's request. Returns whether the host took it (it has the callback). */
export async function tellCancellationConfirmed(ctx: EngineContext, clientId: string, orderId: string): Promise<boolean> {
  const hook = ctx.ports.order.onCancellationConfirmed;
  if (!hook) return false;
  await tell(ctx, "was cancelled on the store's request", orderId, () => hook.call(ctx.ports.order, clientId, orderId));
  return true;
}

/** The store's request failed, refused or timed out. */
export async function tellCancellationFailed(
  ctx: EngineContext,
  clientId: string,
  orderId: string,
  reason: CancellationFailureReason,
): Promise<void> {
  const hook = ctx.ports.order.onCancellationFailed;
  if (!hook) return;
  await tell(ctx, `had its cancellation request fail (${reason})`, orderId, () =>
    hook.call(ctx.ports.order, clientId, orderId, reason),
  );
}

/** How long a request to this adapter may wait for its answer: the engine's override, else the adapter's own. */
export function cancellationWindowMs(ctx: EngineContext, adapter: MarketplaceAdapter): number | null {
  return ctx.ports.cancellationWindowMs ?? adapter.capabilities.cancellationAnswerWindowMs ?? null;
}

/** The columns a request that FAILED for `reason` writes. */
export function failedRequestData(reason: CancellationFailureReason): Record<string, unknown> {
  return { cancellationStatus: "FAILED", cancellationFailureReason: reason };
}
