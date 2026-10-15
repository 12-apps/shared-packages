import { useCallback, useEffect, useState } from "react";

import { NEW_CARD, tokenizerFor, type CardTokenizationConfig, type SavedCard } from "../../card";

import { useCheckoutClientApi } from "./client-context";

/**
 * Where the card path's two inputs come from: the buyer's saved cards and the
 * store's card key. Split out of `./use-card-checkout.ts` at its size gate when
 * the one-list Pagamento step (FUT-3591) needed the saved cards BEFORE any
 * order exists — the list preselects one — and needed to know when the key is
 * still on its way, because its charge runs the moment the 5-second bar fills
 * rather than after the buyer has spent a minute typing.
 */

/**
 * The buyer's saved cards at this store (FUT-697), loaded once per store, and
 * whether the list has answered — "no saved card" and "not asked yet" are
 * different facts to a screen that preselects one.
 */
export function useSavedCardList(tenantSlug: string | undefined): { cards: SavedCard[]; loaded: boolean } {
  const [state, setState] = useState<{ cards: SavedCard[]; loaded: boolean }>({ cards: [], loaded: false });
  const client = useCheckoutClientApi();
  useEffect(() => {
    let active = true;
    // A list that cannot be read is an empty one that HAS answered: the
    // buyer types a card, rather than waiting on a list that never comes.
    void client
      .listInstruments(tenantSlug)
      .catch((): SavedCard[] => [])
      .then((cards) => {
        if (active) setState({ cards, loaded: true });
      });
    return () => {
      active = false;
    };
  }, [tenantSlug, client]);
  return state;
}

/**
 * Saved-card list + current selection — scoped to the current store (FUT-697),
 * so only cards the store's active provider can actually charge are offered.
 * The slug arrives as an argument (the host's routing owns it); absent, the
 * list is unscoped, exactly as before FUT-697.
 *
 * `freshInstrument`: the buyer is here because a card was REFUSED (FUT-1145),
 * so the saved card this would otherwise preselect is the one that just
 * failed. The list is still offered — another saved card may well work — but
 * nothing is chosen for them, which puts the form in front of a buyer whose
 * only untried instrument is a new one.
 */
export function useSavedCards(
  tenantSlug: string | undefined,
  freshInstrument: boolean,
): {
  savedCards: SavedCard[];
  selection: string;
  setSelection: (id: string) => void;
} {
  // The cards and the selection land in ONE update, as they always did: a
  // render holding the cards with nothing selected would flash the new-card
  // form at a buyer whose saved card is about to be chosen for them.
  const [state, setState] = useState<{ savedCards: SavedCard[]; selection: string }>({ savedCards: [], selection: NEW_CARD });
  const client = useCheckoutClientApi();
  useEffect(() => {
    let active = true;
    void client
      .listInstruments(tenantSlug)
      .catch((): SavedCard[] => [])
      .then((cards) => {
        if (!active) return;
        const first = cards[0];
        setState((prev) => ({ savedCards: cards, selection: first && !freshInstrument ? first.id : prev.selection }));
      });
    return () => {
      active = false;
    };
  }, [tenantSlug, client, freshInstrument]);
  const setSelection = useCallback((id: string) => setState((prev) => ({ ...prev, selection: id })), []);
  return { savedCards: state.savedCards, selection: state.selection, setSelection };
}

/**
 * The store's card public key for this order. The checkout config resolved the
 * initial key server-side (`GET /api/checkout/config`, FUT-697); the SPA
 * fetches through the order-scoped refresh route only when the ACTIVE provider
 * is PagBank — the sole provider that can mint a key on demand — and the
 * config arrived without one. A `null` key never means "mock": stub permission
 * travels separately as `mockTokenization`.
 *
 * `keyPending` is true while that refresh has not answered: a charge started
 * before it lands would tokenize with no key at all.
 */
export function useCardPublicKey(
  orderId: string,
  config: CardTokenizationConfig,
): {
  publicKey: string | null;
  setPublicKey: (key: string) => void;
  keyPending: boolean;
} {
  const [publicKey, setPublicKey] = useState<string | null>(config.publicKey);
  const [answered, setAnswered] = useState(false);
  const client = useCheckoutClientApi();
  const refreshable =
    config.provider !== null && tokenizerFor(config.provider) === "pagbank-sdk";
  const asks = config.publicKey === null && refreshable;

  useEffect(() => {
    if (!asks) return undefined;
    let active = true;
    void client
      .refreshBrowserKey({ orderId })
      .then((result) => {
        if (!active) return;
        setAnswered(true);
        if (result.ok && result.data.publicKey) setPublicKey(result.data.publicKey);
      })
      // A refresh that failed has answered too: the charge goes on and the
      // tokenizer says why, rather than the bar waiting forever.
      .catch(() => {
        if (active) setAnswered(true);
      });
    return () => {
      active = false;
    };
  }, [orderId, asks, client]);

  return { publicKey, setPublicKey, keyPending: asks && !answered };
}
