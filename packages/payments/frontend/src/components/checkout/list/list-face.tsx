import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { taxIdKind } from "../../../card";
import { cardChain, cardTokenization, handOffMethod } from "../method-capability";
import { PaymentErrorPanel } from "../payment-error-panel";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { PaymentMethod } from "../types";
import type { useCheckoutController } from "../use-checkout-controller";

import { blockedReason, cardName, raisedMethod } from "./choice";
import { chosenPrice, shownNudges, walletCents, walletTotal } from "./choice-price";
import { buttonFacts, chosenDoor, coveredByHost, inFlight, onlineTotal, unpricedTotal, type ListFaceProps } from "./face-facts";
import { usePaymentListMode, type PaymentListMode } from "./context";
import { armPixCopy, armedReady, otherBankShown, useArmedCharge, useDropRefusedCopy } from "./list-memory";
import { ListNudges } from "./list-nudges";
import { OtherBankLink } from "./list-pix";
import { ChoiceList } from "./choice-list";
import { debitAddressReason, useDebitAddress, useDebitRun, type DebitAddress } from "./debit-address";
import { CardRun, WalletRun, type ListChargeFailure, type WalletSheet } from "./charge-runners";
import { useCvvFirst } from "./cvv-first";
import { ActionButton, ChargeBar, ListBar, holdToneOf } from "./list-bar";
import { ListTop, TopAndRows, cpfAskedBy, gateFields, walletsHeld } from "./list-top";
import { PayerLine } from "./payer-line";
import type { ListCharge } from "./use-list-charge";
import { useApplePayPress, useCloseOrphanSheet, useGooglePayPress, type WalletPressInput } from "./wallet-press";
import type { CheckoutDoorOption, CheckoutOnlineChoice } from "./types";

type Controller = ReturnType<typeof useCheckoutController>;

/** Remember the asked details for next time, as the Dados step's "Continuar" did — only with the buyer's consent. */
function saveAsked(props: ListFaceProps): void {
  const { c, state, saveBuyerContact } = props;
  // The document at the top counts once the buyer typed one: a field revealed
  // over one on file and left empty asks the host to remember nothing new.
  const typedCpf = state.top !== null && (c.buyer.taxId ?? "").trim() !== "";
  if ((state.asked.length === 0 && !typedCpf) || !c.saveProfile) return;
  saveBuyerContact?.({ name: c.buyer.name, phone: c.buyer.phone, taxId: c.buyer.taxId });
}

/** An online choice's press: the card goes through the bar, Pix and the hand-off raise at once. */
function actOnline(props: ListFaceProps, method: CheckoutOnlineChoice, mode: PaymentListMode | null, pick = false): void {
  const { c, charge, cap } = props;
  saveAsked(props);
  if (method === "PIX" && mode) armPixCopy(props.list, mode, pick);
  if (method === "CARD") return charge.start("CARD", onlineTotal(props));
  const raised = method === "PIX" ? "PIX" : handOffMethod(cap.offered);
  if (method === "HAND_OFF") props.onHandOff();
  c.setMethod(raised);
  void c.startPayment(raised);
}

/**
 * The bar's ONE action (M7): the only thing in the list that raises an order
 * or a charge. A door option hands the press to the host; the card counts five
 * seconds first; everything else raises at once.
 */
function useAct(props: ListFaceProps, clearFailure: () => void): (pick?: boolean) => void {
  const mode = usePaymentListMode();
  const cvvFirst = useCvvFirst();
  return (pick = false) => {
    const { choice } = props.state;
    if (!choice || inFlight(props)) return;
    if (choice.kind === "door") return chosenDoor(props)?.onSend();
    if (cvvFirst({ card: props.state.card, choice, covered: coveredByHost(props.list) })) return;
    clearFailure();
    actOnline(props, choice.method, mode, pick);
  };
}

/** The press facts both wallets share — see `./wallet-press.ts`. */
function walletInput(
  props: ListFaceProps,
  held: string | null,
  clearFailures: () => void,
  onFailed: (failure: ListChargeFailure) => void,
  pressed: WalletPressInput["pressed"],
): WalletPressInput {
  return {
    pressed,
    cap: props.cap,
    charge: props.charge,
    // The wallets' own price (FUT-4416), else what an unpriced online payment asks.
    cents: walletCents(props.list),
    total: walletTotal(props.list, unpricedTotal(props)),
    blocked: held !== null || inFlight(props),
    before: () => {
      clearFailures();
      saveAsked(props);
    },
    onFailed,
  };
}

/**
 * A payment made HERE is still possible: the list offers an online way to pay
 * (a row or a ready wallet) and no door row is chosen — nothing chosen counts,
 * since a wallet pays with no row chosen at all (FUT-3685 review). What the
 * host offers for a payment made here (store credit) and who is paying are
 * shown while this holds.
 */
function payingHere(props: ListFaceProps): boolean {
  const offersOnline = props.state.rows.length > 0 || props.cap.wallets.length > 0;
  return offersOnline && props.state.choice?.kind !== "door";
}

/** "Pagando como … · CPF ✓ Alterar" (or "CNPJ ✓") — while a payment here is possible and the document is not open. */
function Payer({ props }: { props: ListFaceProps }): JSX.Element | null {
  const { c, list, taxIdOnFile } = props;
  const name = c.buyer.name?.trim();
  if (!taxIdOnFile || !name || props.revealed || !payingHere(props)) return null;
  return <PayerLine copy={list.copy} name={name} document={taxIdKind(c.buyer.taxId) ?? props.taxIdKindOnFile} onChange={props.onRevealCpf} />;
}

/** The card's charge is past the button: counting down, or going out. */
function cardCharging(charge: ListCharge): boolean {
  return charge.phase === "counting" || (charge.phase === "sending" && charge.kind === "CARD");
}

/**
 * The bar's sentence: the amount frozen at the press, and the card it goes on
 * — or, when the host's balance pays everything, no card at all.
 */
function chargingText(props: ListFaceProps): string {
  const { charge, list, state } = props;
  if (coveredByHost(list) && list.copy.chargingCovered) return list.copy.chargingCovered;
  const selected = state.card.saved.find((card) => card.id === state.card.selection);
  return list.copy.charging(charge.pressedTotal ?? onlineTotal(props), selected ? cardName(list.copy, selected) : null);
}

/** The 5-second bar (or the charge going out), and the host's footer while it counts. */
function ChargingBar({ props, onCancel }: { props: ListFaceProps; onCancel: () => void }): JSX.Element {
  const { charge, list } = props;
  const counting = charge.phase === "counting";
  const footer = counting ? list.chargeFooter?.(charge.cancel) : null;
  return (
    <>
      <ChargeBar text={chargingText(props)} full={!counting} cancelLabel={list.copy.cancel} onCancel={onCancel} />
      {footer ? <Box data-testid="list-charge-footer">{footer}</Box> : null}
    </>
  );
}

/** The button, and "Abrir outro banco" under it when a remembered bank would open. */
function PressButton({ props, act, reason, returnFocus }: {
  props: ListFaceProps;
  act: (pick?: boolean) => void;
  reason: string | null;
  returnFocus: boolean;
}): JSX.Element {
  const { list, state } = props;
  const { label, total, busy } = buttonFacts(props);
  const other = list.pixBank && otherBankShown(list, state, reason === null && !busy) ? list.pixBank.copy.openOther : null;
  return (
    <>
      <ActionButton label={label} total={total} disabled={reason !== null || busy} loading={busy} onClick={() => act()} focusOnMount={returnFocus} />
      {other ? <OtherBankLink label={other} onClick={() => act(true)} /> : null}
    </>
  );
}

/** The button, the 5-second bar, or nothing for a charge nobody can confirm yet. */
function BarAction({ props, failure, act, onCancel, reason, returnFocus }: {
  props: ListFaceProps;
  failure: ListChargeFailure | null;
  act: (pick?: boolean) => void;
  onCancel: () => void;
  reason: string | null;
  returnFocus: boolean;
}): JSX.Element | null {
  if (cardCharging(props.charge)) return <ChargingBar props={props} onCancel={onCancel} />;
  // An UNRESOLVED charge may be holding the buyer's money: no pay control at
  // all under "não pague de novo" (FUT-563), as the card pane does today.
  if (failure?.code === UNRESOLVED_CODE) return null;
  return <PressButton props={props} act={act} reason={reason} returnFocus={returnFocus} />;
}

/** The charge under way, once there is an order to run it against. */
function Runners({ props, sheet, onFailed, onWalletFailed }: {
  props: ListFaceProps;
  sheet: WalletSheet | null;
  onFailed: (failure: ListChargeFailure | null) => void;
  /** A wallet's refusal is said under the wallet buttons, not in a row. */
  onWalletFailed: (failure: ListChargeFailure | null) => void;
}): JSX.Element | null {
  const { c, charge, config } = props;
  const debit = useDebitRun(props.state.choice, props.list);
  const order = charge.chargeable;
  if (!order) return null;
  const common = {
    order, buyer: c.buyer, scope: { tenantSlug: props.tenantSlug, basket: props.basket },
    onResolved: c.handleResolved, pollIntervalMs: props.pollIntervalMs, onAccepted: charge.accepted, onFailed,
  };
  if (charge.kind === "CARD") {
    return <CardRun {...common} card={props.state.card} config={cardTokenization(config)} chain={cardChain(config)} debit={debit} onWaitElapsed={c.handleWaitElapsed} />;
  }
  if (charge.kind !== null && charge.kind === sheet?.type) return <WalletRun {...common} onFailed={onWalletFailed} sheet={sheet} />;
  return null;
}

/** A raise the host refused, with the step's own retry — as the tabs layout shows it. */
function RaiseError({ c, onRetry }: { c: Controller; onRetry: () => void }): JSX.Element | null {
  if (!c.createError || c.order || c.creating) return null;
  return <PaymentErrorPanel message={c.createError} emailFlagged={c.errorField === "email"} code={c.errorCode} onUseEmail={c.payWithEmail} onRetry={onRetry} />;
}

/**
 * Why the button is held: the host's hold, then the list's own reasons, in the
 * prototype's order — the CPF or CNPJ at the top first, for an online choice that needs
 * it (E3); a door choice never does (R3). The debit card's billing address comes
 * last, as it sits below the card's fields (FUT-4109).
 */
function reasonOf(props: ListFaceProps, door: CheckoutDoorOption | undefined, debit: DebitAddress | null, refusal?: ListChargeFailure["refusal"]): string | null {
  const { c, list, state, config } = props;
  const refused = refusal ? { decline: refusal.decline, cvvOnly: state.card.cvvOnly === true, pixOffered: state.methods.includes("PIX") } : null;
  const debitChosen = state.choice?.kind === "online" && state.choice.funding === "DEBIT";
  return blockedReason({
    copy: list.copy, hold: list.hold?.reason ?? null, choice: state.choice, door,
    asked: gateFields(state, c.buyer, config, raisedOf(props)),
    buyer: c.buyer, selection: state.card.selection, cardIsComplete: state.card.complete, covered: coveredByHost(list), refused,
  }) ?? (debitChosen ? debitAddressReason(debit, list.copy.debit) : null);
}

/** The chain method the chosen online option would raise, or `null`. */
function raisedOf(props: ListFaceProps): PaymentMethod | null {
  const { choice } = props.state;
  return choice?.kind === "online" ? raisedMethod(choice.method, props.cap.offered) : null;
}

/**
 * While the bar counts, a charge goes out, a raise or a host send is under way,
 * only Cancelar acts: the list is inert, and the credit and the payer line
 * step aside (FN:587,590).
 */
function barFacts(props: ListFaceProps, door: CheckoutDoorOption | undefined, reason: string | null) {
  const charging = props.charge.phase !== "idle";
  return {
    charging,
    locked: inFlight(props),
    extras: payingHere(props) && !charging ? props.list.onlineExtras : undefined,
    underButton: charging ? null : (door?.error ?? reason),
    live: cardCharging(props.charge) ? chargingText(props) : null,
    discount: chosenPrice(props.list, props.state.choice)?.discount,
  };
}

/**
 * The host's nudges (FUT-4416), while nothing is under way: a link that
 * chooses a row chooses it as its radio would; a door option never.
 */
function BarNudges({ props, hidden }: { props: ListFaceProps; hidden: boolean }): JSX.Element | null {
  const { list, state } = props;
  if (hidden) return null;
  return (
    <ListNudges
      nudges={shownNudges(list.nudges, state.rows, state.choice)}
      onChoose={({ method, funding }) => state.choose({ kind: "online", method, ...(funding ? { funding } : {}) })}
    />
  );
}

/**
 * The bar may still charge only while nothing holds it and the amount it named
 * at the press is still the amount — a hold the host raises, a reason that
 * appears or a total that moves mid-bar stops it, and `send` checks again.
 */
function useChargeGuard(props: ListFaceProps, reason: string | null): void {
  const { charge } = props;
  const allowed = reason === null && (charge.pressedTotal === null || charge.pressedTotal === onlineTotal(props));
  const { setAllowed } = charge;
  useEffect(() => setAllowed(allowed), [allowed, setAllowed]);
}

/** Cancelar by the buyer gives the focus back to the button it replaced. */
function useCancelWithFocus(charge: ListCharge): { returnFocus: boolean; onCancel: () => void } {
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    if (returnFocus && charge.phase === "idle") setReturnFocus(false);
  }, [returnFocus, charge.phase]);
  const { cancel } = charge;
  const onCancel = useCallback(() => {
    setReturnFocus(true);
    cancel();
  }, [cancel]);
  return { returnFocus, onCancel };
}

/**
 * The wallets' sheet, their refusal and the presses that open one. A refusal
 * (or a sheet that could not open) is said under the wallet buttons; a closed
 * sheet (`null`) never clears one the wallet already gave.
 */
function useWallets(props: ListFaceProps, clearFailure: () => void) {
  const sheet = useRef<WalletSheet | null>(null);
  const [failure, setFailure] = useState<ListChargeFailure | null>(null);
  const { settle } = props.charge;
  const onFailed = useCallback((next: ListChargeFailure | null) => { setFailure((previous) => next ?? previous); settle(); }, [settle]);
  const held = walletsHeld({ state: props.state, buyer: props.c.buyer, list: props.list, cap: props.cap, config: props.config });
  const before = () => {
    setFailure(null);
    clearFailure();
  };
  const pressed = useRef(false);
  const input = walletInput(props, held, before, onFailed, pressed);
  const onGoogle = useGooglePayPress(input, sheet);
  const onApple = useApplePayPress(input, sheet);
  useCloseOrphanSheet(props.charge.phase, sheet, pressed);
  return { sheet, held, failure, onFailed, clearWalletFailure: () => setFailure(null), onGoogle, onApple };
}

/** The list, the charge under way, and the bar. */
export function ListFace(props: ListFaceProps): JSX.Element {
  const { c, list, state, charge } = props;
  const [failure, setFailure] = useState<ListChargeFailure | null>(null);
  const clearFailure = useCallback(() => setFailure(null), []);
  const { settle } = charge;
  const { dropOrder } = c;
  // A refusal that closed the order sends the next press to a fresh one (FUT-4401).
  const onFailed = useCallback((next: ListChargeFailure | null) => { setFailure(next); if (next?.refusal?.orderClosed) dropOrder(); settle(); }, [settle, dropOrder]);
  const wallets = useWallets(props, clearFailure);
  const { clearWalletFailure } = wallets;
  const act = useAct(props, () => {
    clearFailure();
    clearWalletFailure();
  });
  const door = chosenDoor(props);
  const reason = reasonOf(props, door, useDebitAddress(), failure?.refusal);
  useChargeGuard(props, reason);
  const free = reason === null && props.charge.phase === "idle" && !c.creating;
  useArmedCharge(armedReady(list, state, free), act);
  useDropRefusedCopy(c.createError);
  const { returnFocus, onCancel } = useCancelWithFocus(charge);
  const shown = charge.phase !== "waiting";
  const facts = barFacts(props, door, reason);
  const rowsShown = useRef(false);
  const top = <ListTop props={props} held={wallets.held} failure={wallets.failure} onGoogle={wallets.onGoogle} onApple={wallets.onApple} rowsShown={rowsShown} />;
  return (
    <Box data-testid="payment-list-step" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {shown ? (
        <TopAndRows rowsShown={rowsShown} drawn={state.settled}>
          <ChoiceList copy={list.copy} prices={list.prices} state={state} door={list.door ?? []} buyer={c.buyer} onBuyerChange={c.setBuyer} provider={props.provider} failure={failure} locked={facts.locked} covered={coveredByHost(list)} cpfAsked={(choice) => cpfAskedBy(state, c.buyer, props.config, props.cap.offered, choice)} top={top} />
        </TopAndRows>
      ) : null}
      <Runners props={props} sheet={wallets.sheet.current} onFailed={onFailed} onWalletFailed={wallets.onFailed} />
      <RaiseError c={c} onRetry={() => act()} />
      {shown ? (
        <ListBar summary={list.summary} sheetHeld={facts.charging} sheetShut={props.revealed} extras={facts.extras} payer={facts.charging ? null : <Payer props={props} />} reason={facts.underButton} reasonTone={holdToneOf(list.hold, facts.underButton)} actionLabel={buttonFacts(props).label} heldTotal={state.choice ? null : props.total} live={facts.live} discount={facts.discount} nudges={<BarNudges props={props} hidden={facts.locked} />}>
          <BarAction props={props} failure={failure ?? wallets.failure} act={act} onCancel={onCancel} reason={reason} returnFocus={returnFocus} />
        </ListBar>
      ) : null}
    </Box>
  );
}
