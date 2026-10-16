import { useEffect } from "react";

import { NEW_CARD } from "../../../card";
import { deferredCopy } from "../pix-parts";

import { bankFlowOs } from "./bank-apps";
import { usePaymentListMode, type PaymentListMode } from "./context";
import type { ListState } from "./use-list-state";
import type { CheckoutPaymentList, PixBankId } from "./types";

/**
 * What the list does with the host's memory of the buyer (FUT-3611, FUT-3612):
 * the bank a Pix opens in, and the charge "Pedir em 1 toque" armed.
 */

/** How long after the step opens an armed charge may still start by itself. */
export const ARMED_WINDOW_MS = 15_000;

/** The bank flow's remembered bank, on a phone — what the Pix button opens. */
function rememberedBank(list: CheckoutPaymentList): PixBankId | null {
  const bank = list.pixBank;
  if (!bank?.remembered || !bankFlowOs(bank.phone)) return null;
  return bank.remembered;
}

/**
 * Pix with the host's bank flow (FUT-3612): the clipboard is opened HERE,
 * inside the tap, for a code the server has not answered yet — the Pix face
 * writes it the moment it arrives, then opens the remembered bank (or, for
 * "Abrir outro banco", shows the six).
 */
export function armPixCopy(list: CheckoutPaymentList, mode: PaymentListMode, pick: boolean): void {
  if (!list.pixBank) return;
  mode.pixIntent.current?.copy.fail();
  const os = bankFlowOs(list.pixBank.phone);
  mode.pixIntent.current = { copy: deferredCopy(), bank: os && !pick ? list.pixBank.remembered : null, pick };
}

function pixChosen(state: ListState): boolean {
  return state.choice?.kind === "online" && state.choice.method === "PIX";
}

/** Pix with the bank flow: "Gerar e copiar o Pix", or "Gerar, copiar e abrir o Nubank". */
export function pixBankLabel(list: CheckoutPaymentList, state: ListState): string | null {
  const bank = list.pixBank;
  if (!bank || !pixChosen(state)) return null;
  const remembered = rememberedBank(list);
  return remembered ? bank.copy.generateCopyAndOpen(bank.copy.names[remembered]) : bank.copy.generateAndCopy;
}

/** "Abrir outro banco" under the button: Pix chosen, a bank remembered, a phone, and the button free to act. */
export function otherBankShown(list: CheckoutPaymentList, state: ListState, free: boolean): boolean {
  return free && pixChosen(state) && rememberedBank(list) !== null;
}

/** A saved card — not the fields — is what the card choice will charge. */
function savedCardChosen(state: ListState): boolean {
  const { choice, card } = state;
  if (choice?.kind !== "online" || choice.method !== "CARD") return false;
  return card.selection !== null && card.selection !== NEW_CARD;
}

/**
 * The armed charge may start now: the host armed it, the saved card the
 * consent named is the one chosen, and nothing (`free`) holds the button.
 */
export function armedReady(list: CheckoutPaymentList, state: ListState, free: boolean): boolean {
  if (!list.armedCharge || !free || !savedCardChosen(state)) return false;
  return list.armedCardId === undefined || state.card.selection === list.armedCardId;
}

/**
 * "Pedir em 1 toque" opened this checkout (FUT-3611): start the card's bar by
 * itself, ONCE per step — as soon as {@link armedReady} holds, within
 * {@link ARMED_WINDOW_MS}. Anything after Cancelar never charges by itself.
 */
export function useArmedCharge(ready: boolean, act: () => void): void {
  const mode = usePaymentListMode();
  useEffect(() => {
    const armed = mode?.armed.current;
    if (!ready || !armed || armed.spent) return;
    // Spent either way: fired now, or too late to be the tap's own charge.
    armed.spent = true;
    if (Date.now() - armed.since <= ARMED_WINDOW_MS) act();
  }, [ready, act, mode]);
}

/** A Pix press whose code never came (the raise was refused) gives the clipboard up. */
export function useDropRefusedCopy(createError: unknown): void {
  const mode = usePaymentListMode();
  useEffect(() => {
    if (!createError || !mode?.pixIntent.current) return;
    mode.pixIntent.current.copy.fail();
    mode.pixIntent.current = null;
  }, [createError, mode]);
}
