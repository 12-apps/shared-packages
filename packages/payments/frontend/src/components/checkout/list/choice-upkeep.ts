import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";

import type { SavedCard } from "../../../card";

import { preselection, soleOption, type OnlineRow } from "./choice";
import type { CheckoutListChoice } from "./types";

/**
 * The host's door ids as one stable array: a host rebuilds its door options
 * every render, and a new array each time would re-run every effect keyed on it.
 */
export function useStableIds(ids: readonly string[] | undefined): readonly string[] {
  const key = (ids ?? []).join("\u0000");
  return useMemo(() => (key === "" ? [] : key.split("\u0000")), [key]);
}

/**
 * Keeps the list's choice true to what is offered NOW, after the one
 * preselection: the options can change under it — a chain that resolved late,
 * a debit row whose billing address went away, a door row the host stopped
 * offering.
 */
export function useChoiceUpkeep(input: {
  settled: boolean;
  touched: { current: boolean };
  choice: CheckoutListChoice | null;
  setChoice: Dispatch<SetStateAction<CheckoutListChoice | null>>;
  apply: (choice: CheckoutListChoice, selection: string | null) => void;
  rows: readonly OnlineRow[];
  doorIds: readonly string[];
  cards: readonly SavedCard[];
  fresh: boolean;
  lastMethod: "PIX" | "CARD" | null;
}): void {
  const { settled, touched, choice, setChoice, apply, rows, doorIds, cards, fresh, lastMethod } = input;
  // A choice no longer offered (a config that resolved to a hand-off store
  // after the card was preselected) is no choice at all. Matched on the funding
  // too: a debit row that went away must not leave a choice the card charge
  // would run as CREDIT (FUT-3754). A door row the host stopped offering is no
  // choice either, now that a sole door row can be chosen for the buyer
  // (FUT-3942).
  useEffect(() => {
    if (choice?.kind === "door") {
      if (!doorIds.includes(choice.id)) setChoice(null);
      return;
    }
    if (choice?.kind !== "online") return;
    if (!rows.some((row) => row.method === choice.method && row.funding === choice.funding && !row.disabled)) setChoice(null);
  }, [choice, rows, doorIds, setChoice]);
  // While the buyer has touched nothing and nothing is chosen, what the one
  // preselection would choose from the options as they are now still is: the
  // buyer's history, else a sole option (FUT-3942).
  useEffect(() => {
    if (!settled || touched.current || choice !== null) return;
    const pick = preselection(rows, cards, fresh, lastMethod) ?? soleOption(rows, doorIds);
    if (pick) apply(pick.choice, pick.selection);
  }, [settled, touched, choice, rows, cards, fresh, lastMethod, doorIds, apply]);
}
