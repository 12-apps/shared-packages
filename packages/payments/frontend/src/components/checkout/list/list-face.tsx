import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { cardChain, cardTokenization, handOffMethod } from "../method-capability";
import { paymentDataRequest, sheetDismissed } from "../google-pay-button";
import { PaymentErrorPanel } from "../payment-error-panel";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { CheckoutBasketIdentity } from "../basket";
import type { BuyerContact, CheckoutProviderConfig } from "../types";
import type { useCheckoutController } from "../use-checkout-controller";
import { useCheckoutComponents } from "../ui";

import { NEW_CARD } from "../../../card";
import { deferredCopy } from "../pix-parts";

import { bankFlowOs } from "./bank-apps";
import { actionLabel, blockedReason, cardName } from "./choice";
import { usePaymentListMode, type PaymentListMode } from "./context";
import { OtherBankLink } from "./list-pix";
import { ChoiceList } from "./choice-list";
import { CardRun, WalletRun, type ListChargeFailure } from "./charge-runners";
import { ActionButton, ChargeBar, GooglePayAction, ListBar } from "./list-bar";
import type { ListCapability } from "./use-capability";
import type { ListCharge } from "./use-list-charge";
import type { ListState } from "./use-list-state";
import type { CheckoutDoorOption, CheckoutOnlineChoice, CheckoutPaymentList, PixBankId } from "./types";

type Controller = ReturnType<typeof useCheckoutController>;

/** Everything the list face reads, gathered by the step. */
interface ListFaceProps {
  c: Controller;
  list: CheckoutPaymentList;
  state: ListState;
  charge: ListCharge;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
  /** The amount the buyer sees now — the cart's, or the balance's. Never a held order's. */
  total: string;
  provider: string | null;
  taxIdOnFile: boolean;
  tenantSlug: string | undefined;
  basket: CheckoutBasketIdentity | undefined;
  pollIntervalMs: number;
  saveBuyerContact?: (contact: BuyerContact) => void;
  /** The hand-off was started: the step shows where the buyer is going. */
  onHandOff: () => void;
}

/** Google Pay's sheet, opened in the tap: its answer and the amount it showed. */
interface OpenSheet {
  answer: Promise<string | null>;
  cents: number;
}

function chosenDoor(props: ListFaceProps): CheckoutDoorOption | undefined {
  const { choice } = props.state;
  if (choice?.kind !== "door") return undefined;
  return props.list.door?.find((option) => option.id === choice.id);
}

/** Something is on its way that a second press would duplicate: a raise, a host send, a charge. */
function inFlight(props: ListFaceProps): boolean {
  const doorPending = props.list.door?.some((option) => option.pending) ?? false;
  return props.c.creating || doorPending || props.charge.phase !== "idle";
}

/** Remember the asked details for next time, as the Dados step's "Continuar" did — only with the buyer's consent. */
function saveAsked(props: ListFaceProps): void {
  const { c, state, saveBuyerContact } = props;
  if (state.asked.length === 0 || !c.saveProfile) return;
  saveBuyerContact?.({ name: c.buyer.name, phone: c.buyer.phone, taxId: c.buyer.taxId });
}

/**
 * What an online payment asks for: the host's amount due when a balance it
 * holds pays part of the cart, else the cart's total (P3).
 */
function onlineTotal(props: ListFaceProps): string {
  return props.list.amountDueLabel ?? props.total;
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
 * Pix with the host's bank flow (FUT-3612): the clipboard is opened HERE,
 * inside the tap, for a code the server has not answered yet — the Pix face
 * writes it the moment it arrives, then opens the remembered bank (or, for
 * "Abrir outro banco", shows the six).
 */
function armPixCopy(list: CheckoutPaymentList, mode: PaymentListMode, pick: boolean): void {
  if (!list.pixBank) return;
  mode.pixIntent.current?.copy.fail();
  const os = bankFlowOs(list.pixBank.phone);
  mode.pixIntent.current = { copy: deferredCopy(), bank: os && !pick ? list.pixBank.remembered : null, pick };
}

/** The bank flow's remembered bank, on a phone — what the Pix button opens. */
function rememberedBank(list: CheckoutPaymentList): PixBankId | null {
  const bank = list.pixBank;
  if (!bank?.remembered || !bankFlowOs(bank.phone)) return null;
  return bank.remembered;
}

/**
 * The bar's ONE action (M7): the only thing in the list that raises an order
 * or a charge. A door option hands the press to the host; the card counts five
 * seconds first; everything else raises at once.
 */
function useAct(props: ListFaceProps, clearFailure: () => void): (pick?: boolean) => void {
  const mode = usePaymentListMode();
  return (pick = false) => {
    const { choice } = props.state;
    if (!choice || inFlight(props)) return;
    if (choice.kind === "door") return chosenDoor(props)?.onSend();
    clearFailure();
    actOnline(props, choice.method, mode, pick);
  };
}

/**
 * "Pedir em 1 toque" opened this checkout (FUT-3611): start the card's bar by
 * itself, ONCE — as soon as the saved card is chosen and nothing holds the
 * button. A choice that is not a saved card (none on file, the fields) never
 * charges by itself.
 */
function useArmedCharge(props: ListFaceProps, reason: string | null, act: () => void): void {
  const fired = useRef(false);
  const { choice, card } = props.state;
  const savedChosen = choice?.kind === "online" && choice.method === "CARD" && card.selection !== null && card.selection !== NEW_CARD;
  const ready = Boolean(props.list.armedCharge) && savedChosen && reason === null && props.charge.phase === "idle" && !props.c.creating;
  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;
    act();
  }, [ready, act]);
}

/** A Pix press whose code never came (the raise was refused) gives the clipboard up. */
function useDropRefusedCopy(c: Controller): void {
  const mode = usePaymentListMode();
  useEffect(() => {
    if (!c.createError || !mode?.pixIntent.current) return;
    mode.pixIntent.current.copy.fail();
    mode.pixIntent.current = null;
  }, [c.createError, mode]);
}

/**
 * Google Pay's press, from Google's own button: the sheet opens HERE, inside
 * the tap, priced with the host's amount due — then the order is raised behind it.
 */
function useGooglePayPress(props: ListFaceProps, clearFailure: () => void, sheet: { current: OpenSheet | null }): () => void {
  return () => {
    const { cap, list, charge } = props;
    const cents = list.totalCents;
    if (!cap.googlePay || cents === undefined || inFlight(props)) return;
    clearFailure();
    saveAsked(props);
    const answer = cap.googlePay.client
      .loadPaymentData(paymentDataRequest(cap.googlePay.params, { totalCents: cents }))
      .then(
        (data) => data.paymentMethodData.tokenizationData.token,
        (error: unknown) => {
          if (sheetDismissed(error)) return null;
          throw error;
        },
      );
    sheet.current = { answer, cents };
    charge.start("GOOGLE_PAY", onlineTotal(props));
  };
}

/** Who is paying, when the store already holds their CPF (FUT-465): "Pagando como … · CPF ✓ Alterar". */
function PayerLine({ props }: { props: ListFaceProps }): JSX.Element | null {
  const { Button, Text } = useCheckoutComponents();
  const { c, list, taxIdOnFile, state } = props;
  const name = c.buyer.name?.trim();
  if (!taxIdOnFile || !name || state.choice?.kind !== "online") return null;
  return (
    // Left-aligned, "Alterar" ~4px after "CPF ✓" and wrapping under it when
    // the name is long; the link keeps a 40px target and a visible focus ring.
    <Box data-testid="list-payer" sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap", columnGap: 0 }}>
      <Text variant="body" size="sm" color="secondary" as="span">
        {list.copy.payer(name)}
      </Text>
      {c.editBuyer ? (
        <Box
          sx={{
            "& button": { textDecoration: "underline", minHeight: (t) => t.spacing(5), minWidth: 0, px: 0.5, py: 0 },
            "& button:focus-visible": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
          }}
        >
          <Button variant="text" color="primary" size="sm" onClick={c.editBuyer} dataTestId="list-payer-change">
            {list.copy.payerChange}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
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

/** Pix with the bank flow: "Gerar e copiar o Pix", or "Gerar, copiar e abrir o Nubank". */
function pixBankLabel(list: CheckoutPaymentList, state: ListState): string | null {
  const bank = list.pixBank;
  if (!bank || state.choice?.kind !== "online" || state.choice.method !== "PIX") return null;
  const remembered = rememberedBank(list);
  return remembered ? bank.copy.generateCopyAndOpen(bank.copy.names[remembered]) : bank.copy.generateAndCopy;
}

/** "Abrir outro banco" under the button: Pix chosen, a bank remembered, a phone, and the button free to act. */
function otherBankShown(props: ListFaceProps, reason: string | null): boolean {
  const { choice } = props.state;
  return choice?.kind === "online" && choice.method === "PIX" && rememberedBank(props.list) !== null && reason === null && !inFlight(props);
}

/** The verb, the amount and the busy state of the button, for what is chosen. */
function buttonFacts(props: ListFaceProps): { label: string; total: string; busy: boolean } {
  const { list, state } = props;
  const door = chosenDoor(props);
  const online = state.choice?.kind === "online";
  return {
    label: list.hold ? list.hold.action : pixBankLabel(list, state) ?? actionLabel(list.copy, state.choice, door, props.provider),
    total: door ? (door.totalLabel ?? props.total) : online ? onlineTotal(props) : props.total,
    busy: inFlight(props),
  };
}

/**
 * Google Pay chosen while the host re-prices (or for the one render before the
 * list drops a choice nobody prices any more): a plain disabled button, never
 * a spinner, with `copy.reasons.repricing` under it.
 */
function googlePayUnpriced(props: ListFaceProps): boolean {
  const { choice } = props.state;
  return choice?.kind === "online" && choice.method === "GOOGLE_PAY" && !props.cap.googlePay;
}

/** Google Pay is chosen and nothing holds it: Google's own button takes the action's place. */
function googlePayLive(props: ListFaceProps, reason: string | null, busy: boolean): boolean {
  const { choice } = props.state;
  return choice?.kind === "online" && choice.method === "GOOGLE_PAY" && props.cap.googlePay !== null && reason === null && !busy;
}

/** The button, the 5-second bar, Google's own button, or nothing for a charge nobody can confirm yet. */
function BarAction({ props, failure, act, onGooglePay, onCancel, reason, returnFocus }: {
  props: ListFaceProps;
  failure: ListChargeFailure | null;
  act: (pick?: boolean) => void;
  onGooglePay: () => void;
  onCancel: () => void;
  reason: string | null;
  returnFocus: boolean;
}): JSX.Element | null {
  const { charge, list, cap } = props;
  if (cardCharging(charge)) {
    const counting = charge.phase === "counting";
    return (
      <>
        <ChargeBar text={chargingText(props)} full={!counting} cancelLabel={list.copy.cancel} onCancel={onCancel} />
        {counting && list.chargeFooter ? <Box data-testid="list-charge-footer">{list.chargeFooter(charge.cancel)}</Box> : null}
      </>
    );
  }
  // An UNRESOLVED charge may be holding the buyer's money: no pay control at
  // all under "não pague de novo" (FUT-563), as the card pane does today.
  if (failure?.code === UNRESOLVED_CODE) return null;
  const { label, total, busy } = buttonFacts(props);
  if (googlePayUnpriced(props)) return <ActionButton label={label} total={total} disabled loading={false} onClick={() => act()} />;
  if (googlePayLive(props, reason, busy) && cap.googlePay) return <GooglePayAction client={cap.googlePay.client} onPress={onGooglePay} />;
  return (
    <>
      <ActionButton label={label} total={total} disabled={reason !== null || busy} loading={busy} onClick={() => act()} focusOnMount={returnFocus} />
      {otherBankShown(props, reason) && list.pixBank ? <OtherBankLink label={list.pixBank.copy.openOther} onClick={() => act(true)} /> : null}
    </>
  );
}

/** The charge under way, once there is an order to run it against. */
function Runners({ props, sheet, onFailed }: {
  props: ListFaceProps;
  sheet: OpenSheet | null;
  onFailed: (failure: ListChargeFailure | null) => void;
}): JSX.Element | null {
  const { c, charge, config } = props;
  const order = charge.chargeable;
  if (!order) return null;
  const common = {
    order, buyer: c.buyer, scope: { tenantSlug: props.tenantSlug, basket: props.basket },
    onResolved: c.handleResolved, pollIntervalMs: props.pollIntervalMs, onAccepted: charge.accepted, onFailed,
  };
  if (charge.kind === "CARD") {
    return <CardRun {...common} card={props.state.card} config={cardTokenization(config)} chain={cardChain(config)} />;
  }
  if (charge.kind === "GOOGLE_PAY" && sheet) return <WalletRun {...common} sheet={sheet.answer} sheetCents={sheet.cents} />;
  return null;
}

/** A raise the host refused, with the step's own retry — as the tabs layout shows it. */
function RaiseError({ c, onRetry }: { c: Controller; onRetry: () => void }): JSX.Element | null {
  if (!c.createError || c.order || c.creating) return null;
  return <PaymentErrorPanel message={c.createError} emailFlagged={c.errorField === "email"} code={c.errorCode} onUseEmail={c.payWithEmail} onRetry={onRetry} />;
}

/** The host's balance pays the whole amount (`totalCents: 0`): no card is asked for or charged. */
function coveredByHost(list: CheckoutPaymentList): boolean {
  return list.totalCents === 0;
}

/** Why the button is held: the host's hold, then the list's own reasons, in the prototype's order. */
function reasonOf(props: ListFaceProps, door: CheckoutDoorOption | undefined): string | null {
  const { c, list, state } = props;
  const reason = blockedReason({
    copy: list.copy, hold: list.hold?.reason ?? null, choice: state.choice, door, asked: state.asked,
    buyer: c.buyer, selection: state.card.selection, cardIsComplete: state.card.complete, covered: coveredByHost(list),
  });
  return reason ?? (googlePayUnpriced(props) ? (list.copy.reasons.repricing ?? null) : null);
}

/**
 * While the bar counts, a charge goes out, a raise or a host send is under way,
 * only Cancelar acts: the list is inert, and the credit and the payer line
 * step aside (FN:587,590).
 */
function barFacts(props: ListFaceProps, door: CheckoutDoorOption | undefined, reason: string | null) {
  const charging = props.charge.phase !== "idle";
  const online = props.state.choice?.kind === "online";
  return {
    charging,
    locked: inFlight(props),
    extras: online && !charging ? props.list.onlineExtras : undefined,
    underButton: charging ? null : (door?.error ?? reason),
    live: cardCharging(props.charge) ? chargingText(props) : null,
  };
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

/** The list, the charge under way, and the bar. */
export function ListFace(props: ListFaceProps): JSX.Element {
  const { c, list, state, charge } = props;
  const [failure, setFailure] = useState<ListChargeFailure | null>(null);
  const clearFailure = useCallback(() => setFailure(null), []);
  const { settle } = charge;
  const onFailed = useCallback((next: ListChargeFailure | null) => { setFailure(next); settle(); }, [settle]);
  const sheet = useRef<OpenSheet | null>(null);
  const act = useAct(props, clearFailure);
  const onGooglePay = useGooglePayPress(props, clearFailure, sheet);
  const door = chosenDoor(props);
  const reason = reasonOf(props, door);
  useChargeGuard(props, reason);
  useArmedCharge(props, reason, act);
  useDropRefusedCopy(c);
  const { returnFocus, onCancel } = useCancelWithFocus(charge);
  const shown = charge.phase !== "waiting";
  const facts = barFacts(props, door, reason);
  return (
    <Box data-testid="payment-list-step" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {shown ? (
        <ChoiceList copy={list.copy} state={state} door={list.door ?? []} buyer={c.buyer} onBuyerChange={c.setBuyer} provider={props.provider} failure={failure} locked={facts.locked} covered={coveredByHost(list)} />
      ) : null}
      <Runners props={props} sheet={sheet.current} onFailed={onFailed} />
      <RaiseError c={c} onRetry={() => act()} />
      {shown ? (
        <ListBar summary={list.summary} extras={facts.extras} payer={facts.charging ? null : <PayerLine props={props} />} reason={facts.underButton} live={facts.live}>
          <BarAction props={props} failure={failure} act={act} onGooglePay={onGooglePay} onCancel={onCancel} reason={reason} returnFocus={returnFocus} />
        </ListBar>
      ) : null}
    </Box>
  );
}
