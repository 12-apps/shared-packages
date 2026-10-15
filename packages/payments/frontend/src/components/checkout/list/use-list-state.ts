import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { NEW_CARD, type CardDetails, type CardFieldErrors, type SavedCard } from "../../../card";
import { useSavedCardList } from "../card-sources";
import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo, CheckoutCustomerField, CheckoutProviderConfig } from "../types";

import { askedFields, cardComplete, lastUsedCard, onlineRows, preselection, raisedMethod, type OnlineCapability, type OnlineRow } from "./choice";
import type { CheckoutListChoice } from "./types";

const EMPTY_CARD: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

/** The card the buyer pays with, as the list holds it before any order exists. */
export interface ListCard {
  saved: SavedCard[];
  /** A saved card's id, `NEW_CARD` for the fields, or `null` when none is chosen. */
  selection: string | null;
  setSelection: (selection: string | null) => void;
  card: CardDetails;
  setCard: Dispatch<SetStateAction<CardDetails>>;
  fieldErrors: CardFieldErrors;
  setFieldErrors: Dispatch<SetStateAction<CardFieldErrors>>;
  saveCard: boolean;
  setSaveCard: (save: boolean) => void;
  complete: boolean;
}

/** Everything the one list holds, and nothing it raises. */
export interface ListState {
  rows: OnlineRow[];
  choice: CheckoutListChoice | null;
  choose: (next: CheckoutListChoice) => void;
  card: ListCard;
  /** The buyer's own details the chosen online option must ask for (M11). */
  asked: CheckoutCustomerField[];
}

/**
 * The card the buyer is typing or has picked. It outlives every order raised
 * under it: the charge reads it when the 5-second bar fills, and a refusal
 * brings the buyer back to it as they left it.
 */
function useListCard(saved: SavedCard[]): ListCard {
  const fieldCopy = useCheckoutCopy().card.fields;
  const [selection, setSelection] = useState<string | null>(null);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [saveCard, setSaveCard] = useState(false);
  const complete = useMemo(() => cardComplete(card, fieldCopy), [card, fieldCopy]);
  return { saved, selection, setSelection, card, setCard, fieldErrors, setFieldErrors, saveCard, setSaveCard, complete };
}

/**
 * Preselect ONCE, when the saved cards answer — never over a choice the buyer
 * already made, and never again after they made one (M7).
 */
function usePreselect(
  loaded: boolean,
  rows: readonly OnlineRow[],
  saved: readonly SavedCard[],
  fresh: boolean,
  apply: (choice: CheckoutListChoice, selection: string | null) => void,
  touched: { current: boolean },
): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || touched.current || !loaded) return;
    done.current = true;
    const pick = preselection(rows, saved, fresh);
    if (pick) apply(pick.choice, pick.selection);
  }, [loaded, rows, saved, fresh, apply, touched]);
}

/**
 * The card chosen again: the one used last (else the head of the saved list) —
 * or, for a buyer back from a refused card (FUT-1145), no saved card at all
 * (that one may be the card that failed), or the fields when nothing is saved.
 */
function reopenedSelection(cards: readonly SavedCard[], fresh: boolean): string | null {
  const head = lastUsedCard(cards);
  if (!head) return NEW_CARD;
  return fresh ? null : head.id;
}

/**
 * The one list's state (FUT-3591). Picking an option changes THIS and nothing
 * else: no order, no charge, no request — the bar's button is the only thing
 * that raises (M7). The host hears about every change through
 * `onChoiceChange`, which is how its door options learn they are chosen.
 */
export function useListState(input: {
  config: CheckoutProviderConfig | null;
  capability: OnlineCapability;
  tenantSlug: string | undefined;
  /** Back here after a refused card (FUT-1145): no saved card is selected for them. */
  fresh: boolean;
  arrivedWith: BuyerInfo | undefined;
  taxIdOnFile: boolean;
  onChoiceChange?: (choice: CheckoutListChoice | null) => void;
}): ListState {
  const { capability } = input;
  const rows = useMemo(() => onlineRows(capability), [capability]);
  const { cards, loaded } = useSavedCardList(input.tenantSlug);
  const card = useListCard(cards);
  const [choice, setChoice] = useState<CheckoutListChoice | null>(null);
  const touched = useRef(false);
  const { setSelection } = card;
  const apply = useCallback(
    (next: CheckoutListChoice, selection: string | null) => {
      setChoice(next);
      if (selection !== null) setSelection(selection);
    },
    [setSelection],
  );
  usePreselect(loaded, rows, cards, input.fresh, apply, touched);
  const choose = useCallback(
    (next: CheckoutListChoice) => {
      touched.current = true;
      setChoice((previous) => {
        // Coming back to the card from another option starts on the head of
        // the saved list again (FN:420), or on the fields when there is none;
        // what was typed in them is kept.
        const reopensCard = next.kind === "online" && next.method === "CARD" && !(previous?.kind === "online" && previous.method === "CARD");
        if (reopensCard) setSelection(reopenedSelection(cards, input.fresh));
        return next;
      });
    },
    [cards, setSelection, input.fresh],
  );
  // A choice the chain no longer offers (a config that resolved to a hand-off
  // store after the card was preselected) is no choice at all.
  useEffect(() => {
    if (choice?.kind === "online" && !rows.some((row) => row.method === choice.method && !row.disabled)) setChoice(null);
  }, [choice, rows]);
  const { onChoiceChange } = input;
  useEffect(() => {
    onChoiceChange?.(choice);
  }, [choice, onChoiceChange]);
  const asked = useMemo(
    () =>
      choice?.kind === "online"
        ? askedFields({
            chain: input.config?.chain,
            method: raisedMethod(choice.method, capability.offered),
            arrivedWith: input.arrivedWith,
            taxIdOnFile: input.taxIdOnFile,
          })
        : [],
    [choice, input.config, capability.offered, input.arrivedWith, input.taxIdOnFile],
  );
  return { rows, choice, choose, card, asked };
}
