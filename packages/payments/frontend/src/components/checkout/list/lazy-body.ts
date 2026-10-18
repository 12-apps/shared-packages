import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { useCheckoutComponents, type CheckoutLazy } from "../ui";

/**
 * A part of the list loaded as a chunk of its own (FUT-3711), through the
 * host's `lazy` slot — its stale-chunk-safe loader — or React's `lazy` when the
 * host fills none.
 *
 * Each loader builds the deferred component ONCE and keeps it, keyed by the
 * loader itself: a component made on every render would be a new type every
 * render, remounting the part and suspending it again each time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's own `lazy` constraint
export function deferredPart<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): () => LazyExoticComponent<T> {
  const made = new WeakMap<CheckoutLazy, LazyExoticComponent<T>>();
  return function useDeferredPart(): LazyExoticComponent<T> {
    const loader = useCheckoutComponents().lazy ?? lazy;
    let part = made.get(loader);
    if (!part) {
      part = loader(load);
      made.set(loader, part);
    }
    return part;
  };
}
