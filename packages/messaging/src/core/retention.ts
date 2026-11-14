import type { EngineContext } from "./context";

/**
 * The retention sweep. A conversation's TEXT lives only while the
 * conversation does: `retentionMs` (default 12 h) after its LAST message,
 * every message's body, choices and transcript are deleted. The conversation
 * row, its state and its structured summary stay — they are what the next
 * conversation with the same contact starts from.
 *
 * One indexed query finds the due conversations across every tenant (never a
 * walk over tenants); a pass that fills its batch says so, and the next tick
 * takes the rest.
 */
export async function sweepRetention(ctx: EngineContext): Promise<{ conversations: number; messages: number; more: boolean }> {
  const { store, clock, retentionMs, retentionBatchSize } = ctx.config;
  const cutoff = new Date(clock.now().getTime() - retentionMs);
  const result = await store.purgeExpiredText({ cutoff, take: retentionBatchSize });
  return { ...result, more: result.conversations === retentionBatchSize };
}
