/**
 * The one funnel every upsell trigger converges on: proactive locks (nav
 * rows, `withEntitlement` page locks, `<Locked>` surfaces via the provider's
 * `onUpsell`) and reactive 402s from the API client all `raiseUpsell`, and
 * the single prompt host mounted by the app subscribes.
 *
 * A module-level emitter rather than context because 402 interception
 * typically lives on an HTTP client constructed outside the React tree.
 */
import type { UpsellPrompt } from '../plan-wire';

export type { UpsellPrompt, UpsellReason } from '../plan-wire';
export { upsellPromptFromPaymentRequired } from '../plan-wire';

type UpsellListener = (prompt: UpsellPrompt) => void;

const listeners = new Set<UpsellListener>();

/** Raise the upsell surface. No-op until a prompt host subscribes. */
export function raiseUpsell(prompt: UpsellPrompt): void {
  for (const listener of listeners) listener(prompt);
}

/** Subscribe the prompt host; returns the unsubscribe. */
export function subscribeToUpsell(listener: UpsellListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
