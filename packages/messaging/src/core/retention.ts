import type { EngineContext } from "./context";

/**
 * The retention sweep. A conversation's TEXT lives only while the
 * conversation does: `retentionMs` (default 12 h) after its LAST message,
 * every message's body, choices and transcript are deleted. The conversation
 * row, its state and its structured summary stay — they are what the next
 * conversation with the same contact starts from.
 *
 * The same cutoff deletes the raw inbox rows (Meta's whole payload: the text,
 * the phone number, the profile name): the PROCESSED ones, and the FAILED ones
 * nothing will retry any more. What stays of a delivery is nothing; dedupe
 * lives on the message row's `(channel, external_id)`, which outlives the text.
 *
 * One indexed query finds the due conversations across every tenant (never a
 * walk over tenants); a pass that fills its batch says so, and the next tick
 * takes the rest.
 */
export async function sweepRetention(
  ctx: EngineContext,
): Promise<{ conversations: number; messages: number; deliveries: number; more: boolean }> {
  const { store, clock, retentionMs, retentionBatchSize, maxDeliveryAttempts } = ctx.config;
  const cutoff = new Date(clock.now().getTime() - retentionMs);
  const text = await store.purgeExpiredText({ cutoff, take: retentionBatchSize });
  const deliveries = await store.purgeExpiredDeliveries({ cutoff, maxAttempts: maxDeliveryAttempts, take: retentionBatchSize });
  return { ...text, deliveries, more: text.conversations === retentionBatchSize || deliveries >= retentionBatchSize };
}
