/**
 * The buyer-facing screens the factory binds (FUT-741), part one: reusing a
 * card, and the empty cart.
 *
 * Every one of them is a THIN binding. The behaviour still lives in the
 * components this package already shipped; what is new is that the config,
 * the transport, the scope and the slots arrive from the factory instead of
 * from six props the host had to thread itself.
 */
import { useEffect, useState, type JSX } from "react";

import { SavedCardsPicker, type SavedCard } from "../card";
import { EmptyCart as EmptyCartView } from "../components/checkout/empty-cart";

import { FlowsShell, type FlowsRuntime } from "./runtime";
import type { CheckoutScreens } from "./types";

/** The vaulted instruments this store can actually charge (FUT-697 scoping). */
function useScopedInstruments(runtime: FlowsRuntime): SavedCard[] {
  const tenantSlug = runtime.useTenantSlug();
  const [cards, setCards] = useState<SavedCard[]>([]);
  useEffect(() => {
    let active = true;
    void runtime.client.listInstruments(tenantSlug).then((list) => {
      if (active) setCards(list);
    });
    return () => {
      active = false;
    };
  }, [runtime, tenantSlug]);
  return cards;
}

function buildSavedCards(runtime: FlowsRuntime): CheckoutScreens["SavedCards"] {
  function SavedCardsBody({
    selection,
    onSelect,
  }: {
    selection: string;
    onSelect: (id: string) => void;
  }): JSX.Element | null {
    const savedCards = useScopedInstruments(runtime);
    // Nothing to reuse renders nothing at all — an empty picker is a heading
    // over a void, and the new-card form below it already says what to do.
    if (savedCards.length === 0) return null;
    return <SavedCardsPicker savedCards={savedCards} selection={selection} onSelect={onSelect} />;
  }
  return function SavedCards(props) {
    return (
      <FlowsShell runtime={runtime}>
        <SavedCardsBody {...props} />
      </FlowsShell>
    );
  };
}

function buildEmptyCart(runtime: FlowsRuntime): CheckoutScreens["EmptyCart"] {
  return function EmptyCart() {
    return (
      <FlowsShell runtime={runtime}>
        <EmptyCartView copy={runtime.copy.views.emptyCart} onBack={runtime.config.ports.exitToCatalog} />
      </FlowsShell>
    );
  };
}

export const buyerScreens = {
  buildSavedCards,
  buildEmptyCart,
};
