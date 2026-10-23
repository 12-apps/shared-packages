import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { NEW_CARD, type CardDetails, type CardFieldErrors, type SavedCard } from "../../../card";
import { useSavedCardList } from "../card-sources";
import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo, CheckoutCustomerField, CheckoutProviderConfig, PaymentMethod } from "../types";

import { askedFields, cardComplete, lastUsedCard, onlineRows, preselection, raisedMethod, soleOption, type OnlineCapability, type OnlineRow } from "./choice";
import { isTaxId, topCpfField } from "./top-cpf";
import type { CheckoutListChoice } from "./types";
import type { ListWallet } from "./use-capability";

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
  /**
   * The saved cards answered and the one preselection ran (FUT-3849). Until
   * then nothing may be offered to tap: the preselected card opens its chips
   * when it lands and moves every row below it, under the buyer's finger.
   */
  settled: boolean;
  choice: CheckoutListChoice | null;
  choose: (next: CheckoutListChoice) => void;
  card: ListCard;
  /**
   * The buyer's own details the chosen online option asks for INSIDE its row
   * (M11) — the hand-off provider's mobile (K4). Never the CPF: that is `top`.
   */
  asked: CheckoutCustomerField[];
  /** The CPF asked at the top of Pagamento, or `null` (FUT-3685, E1/E2). */
  top: CheckoutCustomerField | null;
  /** Every online method the list offers, wallets included — what the top CPF is decided over (R2). */
  methods: PaymentMethod[];
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
 * already made, and never again after they made one (M7). With nothing the
 * buyer's history picks, a list's only option is chosen ({@link soleOption}).
 */
function usePreselect(
  loaded: boolean,
  rows: readonly OnlineRow[],
  saved: readonly SavedCard[],
  fresh: boolean,
  lastMethod: "PIX" | "CARD" | null,
  doorIds: readonly string[],
  apply: (choice: CheckoutListChoice, selection: string | null) => void,
  touched: { current: boolean },
): boolean {
  const done = useRef(false);
  // Set in the same effect as the preselection, so the render that first
  // draws the rows already holds the choice they will keep.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (done.current || touched.current || !loaded) return;
    done.current = true;
    const pick = preselection(rows, saved, fresh, lastMethod) ?? soleOption(rows, doorIds);
    if (pick) apply(pick.choice, pick.selection);
    setSettled(true);
  }, [loaded, rows, saved, fresh, lastMethod, doorIds, apply, touched]);
  return settled;
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
 * The card selection a choice opens on, or `undefined` when it opens no card.
 * Coming back to the card from another option starts on the head of the saved
 * list again (FN:420), or on the fields when there is none; what was typed in
 * them is kept. The debit row always types one: a saved card is charged as
 * credit (FUT-3754).
 */
function cardOpenedBy(
  previous: CheckoutListChoice | null,
  next: CheckoutListChoice,
  cards: readonly SavedCard[],
  fresh: boolean,
): string | null | undefined {
  if (next.kind !== "online" || next.method !== "CARD") return undefined;
  const sameRow = previous?.kind === "online" && previous.method === "CARD" && previous.funding === next.funding;
  if (sameRow) return undefined;
  return next.funding === "DEBIT" ? NEW_CARD : reopenedSelection(cards, fresh);
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
  /** The buyer's last online method, from the host (FUT-3611). */
  lastMethod?: "PIX" | "CARD" | null;
  onChoiceChange?: (choice: CheckoutListChoice | null) => void;
  /** The wallets the block above the list draws — each raises a CARD order. */
  wallets?: readonly ListWallet[];
  /** "Alterar" on the payer line revealed the CPF at the top (E2 → E1). */
  revealed?: boolean;
  /** The host's door rows' ids, in order — a sole option among them is chosen (FUT-3942). */
  doorIds?: readonly string[];
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
  const doorKey = (input.doorIds ?? []).join("\u0000");
  const doorIds = useMemo(() => (doorKey === "" ? [] : doorKey.split("\u0000")), [doorKey]);
  const settled = usePreselect(loaded, rows, cards, input.fresh, input.lastMethod ?? null, doorIds, apply, touched);
  const choose = useCallback(
    (next: CheckoutListChoice) => {
      touched.current = true;
      setChoice((previous) => {
        const selection = cardOpenedBy(previous, next, cards, input.fresh);
        if (selection !== undefined) setSelection(selection);
        return next;
      });
    },
    [cards, setSelection, input.fresh],
  );
  // A choice the chain no longer offers (a config that resolved to a hand-off
  // store after the card was preselected) is no choice at all. Matched on the
  // funding too: a debit row that went away (its billing address with it) must
  // not leave a choice the card charge would run as CREDIT (FUT-3754).
  useEffect(() => {
    if (choice?.kind === "door") {
      // A door row the host stopped offering is no choice either (FUT-3942:
      // a sole door row can now be chosen for the buyer).
      if (!doorIds.includes(choice.id)) setChoice(null);
      return;
    }
    if (choice?.kind !== "online") return;
    if (!rows.some((row) => row.method === choice.method && row.funding === choice.funding && !row.disabled)) setChoice(null);
  }, [choice, rows, doorIds]);
  // The options can change after the one preselection — a chain that resolved
  // to a hand-off store late, a choice the chain stopped offering. While the
  // buyer has touched nothing and nothing is chosen, a sole option still is.
  const lastMethod = input.lastMethod ?? null;
  useEffect(() => {
    if (!settled || touched.current || choice !== null) return;
    const pick = preselection(rows, cards, input.fresh, lastMethod) ?? soleOption(rows, doorIds);
    if (pick) apply(pick.choice, pick.selection);
  }, [settled, choice, rows, cards, input.fresh, lastMethod, doorIds, apply]);
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
          }).filter((field) => !isTaxId(field))
        : [],
    [choice, input.config, capability.offered, input.arrivedWith, input.taxIdOnFile],
  );
  const methods = useMemo(() => offeredOnline(rows, capability.offered, input.wallets ?? []), [rows, capability.offered, input.wallets]);
  const top = useMemo(
    () =>
      topCpfField({
        chain: input.config?.chain,
        methods,
        arrivedWith: input.arrivedWith,
        taxIdOnFile: input.taxIdOnFile,
        revealed: input.revealed ?? false,
      }),
    [input.config, methods, input.arrivedWith, input.taxIdOnFile, input.revealed],
  );
  return { rows, settled, choice, choose, card, asked, top, methods };
}

/** The chain methods the list's rows and wallets would raise, each once. */
function offeredOnline(rows: readonly OnlineRow[], offered: PaymentMethod[] | null, wallets: readonly ListWallet[]): PaymentMethod[] {
  const methods = new Set<PaymentMethod>();
  for (const row of rows) if (!row.disabled) methods.add(raisedMethod(row.method, offered));
  if (wallets.length > 0) methods.add("CARD");
  return [...methods];
}
