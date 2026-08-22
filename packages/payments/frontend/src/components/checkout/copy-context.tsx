'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';

import type { CardCopy } from '../../card/copy';

/**
 * The buyer checkout's words, for the screens too deep to reach by prop
 * (FUT-760).
 *
 * The existing `CheckoutViewCopy` is a required PROP, and that is still the
 * right shape for the flow's own screens — a host wiring the checkout passes
 * it at the one call that mounts them. This context exists for the parts that
 * prop cannot reach without threading it through four intermediate
 * components: the card fields, the wallet panes, the method tiles.
 *
 * It sits beside `CheckoutComponentsProvider` because the two answer the same
 * kind of question — a host's design system there, a host's language here —
 * and a screen that has one always has the other.
 */
export interface CheckoutCopy {
  /** The card form and its tokenizers. */
  card: CardCopy;
  /** The buyer-details step's own fields and their refusals. */
  buyer: BuyerInfoCopy;
}

/**
 * The buyer-details step: what it asks for, and what it says when the answer
 * will not do.
 */
export interface BuyerInfoCopy {
  emailInvalid: string;
  emailRequired: string;
  nameRequired: string;
  phoneRequired: string;
  /**
   * The hint above the fields, built from what the store's provider actually
   * DEMANDS — which fields those are is the package's answer, and it changes
   * per store.
   *
   * A function over the required field names, not a template with a slot: the
   * sentence agrees its adjective with how many there are ("obrigatório" /
   * "obrigatórios"), and a `{fields}` hole would have this package deciding
   * that agreement for every language.
   */
  fieldsHint(requiredFieldNames: readonly string[]): string;
}

const CheckoutCopyContext = createContext<CheckoutCopy | null>(null);

export function CheckoutCopyProvider({
  copy,
  children,
}: {
  copy: CheckoutCopy;
  children: ReactNode;
}): JSX.Element {
  return <CheckoutCopyContext.Provider value={copy}>{children}</CheckoutCopyContext.Provider>;
}

/**
 * The words this checkout renders — THROWS outside a provider rather than
 * falling back.
 *
 * A fallback could only be the origin host's Portuguese, handed silently to
 * the next adopter's shopper. Failing at the mount is the whole point: it is
 * the one moment a host can still be told it forgot.
 */
export function useCheckoutCopy(): CheckoutCopy {
  const copy = useContext(CheckoutCopyContext);
  if (!copy) {
    throw new Error('useCheckoutCopy must be rendered inside a <CheckoutCopyProvider>');
  }
  return copy;
}
