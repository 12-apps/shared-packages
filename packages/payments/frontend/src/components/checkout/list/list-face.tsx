import { Box } from "@mui/material";
import { useCallback, useState, type JSX } from "react";

import { cardChain, cardTokenization, handOffMethod } from "../method-capability";
import { PaymentErrorPanel } from "../payment-error-panel";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { CheckoutBasketIdentity } from "../basket";
import type { BuyerContact, CheckoutProviderConfig } from "../types";
import type { useCheckoutController } from "../use-checkout-controller";
import { useCheckoutComponents } from "../ui";

import { actionLabel, blockedReason } from "./choice";
import { ChoiceList } from "./choice-list";
import { CardRun, WalletRun, type ListChargeFailure } from "./charge-runners";
import { ActionButton, ChargeBar, ListBar } from "./list-bar";
import type { ListCapability } from "./use-capability";
import type { ListCharge } from "./use-list-charge";
import type { ListState } from "./use-list-state";
import type { CheckoutDoorOption, CheckoutOnlineChoice, CheckoutPaymentList } from "./types";

type Controller = ReturnType<typeof useCheckoutController>;

/** Everything the list face reads, gathered by the step. */
interface ListFaceProps {
  c: Controller;
  list: CheckoutPaymentList;
  state: ListState;
  charge: ListCharge;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
  /** The amount the button names: the held order's, else the cart's. */
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

function chosenDoor(props: ListFaceProps): CheckoutDoorOption | undefined {
  const { choice } = props.state;
  if (choice?.kind !== "door") return undefined;
  return props.list.door?.find((option) => option.id === choice.id);
}

/** Remember the asked details for next time, as the Dados step's "Continuar" did (LGPD-gated by the same flag). */
function saveAsked(props: ListFaceProps): void {
  const { c, state, saveBuyerContact } = props;
  if (state.asked.length === 0 || !c.saveProfile) return;
  saveBuyerContact?.({ name: c.buyer.name, phone: c.buyer.phone, taxId: c.buyer.taxId });
}

/** An online choice's press: the card and Google Pay go through the charge, the rest raise at once. */
function actOnline(props: ListFaceProps, method: CheckoutOnlineChoice): void {
  const { c, charge, cap } = props;
  saveAsked(props);
  if (method === "CARD" || method === "GOOGLE_PAY") return charge.start(method);
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
function useAct(props: ListFaceProps, clearFailure: () => void): () => void {
  return () => {
    const { choice } = props.state;
    if (!choice) return;
    if (choice.kind === "door") return chosenDoor(props)?.onSend();
    clearFailure();
    actOnline(props, choice.method);
  };
}

/** Who is paying, when the store already holds their CPF (FUT-465): "Pagando como … · CPF ✓ Alterar". */
function PayerLine({ props }: { props: ListFaceProps }): JSX.Element | null {
  const { Button, Text } = useCheckoutComponents();
  const { c, list, taxIdOnFile, state } = props;
  const name = c.buyer.name?.trim();
  if (!taxIdOnFile || !name || state.choice?.kind !== "online") return null;
  return (
    <Box data-testid="list-payer" sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 0.5 }}>
      <Text variant="caption" size="sm" color="secondary" as="span">
        {list.copy.payer(name)}
      </Text>
      {c.editBuyer ? (
        <Box sx={{ "& button": { textDecoration: "underline", minHeight: 0, p: 0 } }}>
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

/** The card's 5-second bar while it counts, and filled while the charge goes out. */
function CardChargeBar({ props }: { props: ListFaceProps }): JSX.Element {
  const { charge, list, state, total } = props;
  const selected = state.card.saved.find((card) => card.id === state.card.selection);
  const named = selected ? list.copy.savedCard(selected.brand, selected.last4) : null;
  return <ChargeBar text={list.copy.charging(total, named)} full={charge.phase !== "counting"} cancelLabel={list.copy.cancel} onCancel={charge.cancel} />;
}

/** The verb, the amount and the busy state of the button, for what is chosen. */
function buttonFacts(props: ListFaceProps): { label: string; total: string; busy: boolean } {
  const { c, charge, list, state } = props;
  const door = chosenDoor(props);
  return {
    label: list.hold ? list.hold.action : actionLabel(list.copy, state.choice, door, props.provider),
    total: door?.totalLabel ?? props.total,
    busy: c.creating || charge.phase === "sending" || Boolean(door?.pending),
  };
}

/** The button, the 5-second bar, or nothing at all for a charge nobody can confirm yet. */
function BarAction({ props, failure, act, reason }: {
  props: ListFaceProps;
  failure: ListChargeFailure | null;
  act: () => void;
  reason: string | null;
}): JSX.Element | null {
  if (cardCharging(props.charge)) return <CardChargeBar props={props} />;
  // An UNRESOLVED charge may be holding the buyer's money: no pay control at
  // all under "não pague de novo" (FUT-563), as the card pane does today.
  if (failure?.code === UNRESOLVED_CODE) return null;
  const { label, total, busy } = buttonFacts(props);
  return <ActionButton label={label} total={total} disabled={reason !== null || busy} loading={busy} onClick={act} />;
}

/** The charge under way, once there is an order to run it against. */
function Runners({ props, onFailed }: { props: ListFaceProps; onFailed: (failure: ListChargeFailure | null) => void }): JSX.Element | null {
  const { c, charge, cap, config } = props;
  const order = charge.chargeable;
  if (!order) return null;
  const common = {
    order, buyer: c.buyer, scope: { tenantSlug: props.tenantSlug, basket: props.basket },
    onResolved: c.handleResolved, pollIntervalMs: props.pollIntervalMs, onAccepted: charge.accepted, onFailed,
  };
  if (charge.kind === "CARD") {
    return <CardRun {...common} card={props.state.card} config={cardTokenization(config)} chain={cardChain(config)} />;
  }
  if (charge.kind === "GOOGLE_PAY" && cap.googlePay) {
    return <WalletRun {...common} client={cap.googlePay.client} params={cap.googlePay.params} />;
  }
  return null;
}

/** A raise the host refused, with the step's own retry — as the tabs layout shows it. */
function RaiseError({ c, onRetry }: { c: Controller; onRetry: () => void }): JSX.Element | null {
  if (!c.createError || c.order || c.creating) return null;
  return <PaymentErrorPanel message={c.createError} emailFlagged={c.errorField === "email"} code={c.errorCode} onUseEmail={c.payWithEmail} onRetry={onRetry} />;
}

/** Why the button is held: the host's hold, then the list's own reasons, in the prototype's order. */
function reasonOf(props: ListFaceProps, door: CheckoutDoorOption | undefined): string | null {
  const { c, list, state } = props;
  return blockedReason({
    copy: list.copy, hold: list.hold?.reason ?? null, choice: state.choice, door, asked: state.asked,
    buyer: c.buyer, selection: state.card.selection, cardIsComplete: state.card.complete,
  });
}

/**
 * While the bar counts or the charge goes out, only Cancelar acts: the list is
 * inert, and the credit and the payer line step aside (FN:587,590).
 */
function barFacts(props: ListFaceProps, door: CheckoutDoorOption | undefined, reason: string | null) {
  const charging = props.charge.phase !== "idle";
  const online = props.state.choice?.kind === "online";
  return {
    charging,
    extras: online && !charging ? props.list.onlineExtras : undefined,
    underButton: charging ? null : (door?.error ?? reason),
  };
}

/** The list, the charge under way, and the bar. */
export function ListFace(props: ListFaceProps): JSX.Element {
  const { c, list, state, charge } = props;
  const [failure, setFailure] = useState<ListChargeFailure | null>(null);
  const clearFailure = useCallback(() => setFailure(null), []);
  const { settle } = charge;
  const onFailed = useCallback((next: ListChargeFailure | null) => { setFailure(next); settle(); }, [settle]);
  const act = useAct(props, clearFailure);
  const door = chosenDoor(props);
  const reason = reasonOf(props, door);
  const shown = charge.phase !== "waiting";
  const { charging, extras, underButton } = barFacts(props, door, reason);
  return (
    <Box data-testid="payment-list-step" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {shown ? (
        <ChoiceList copy={list.copy} state={state} door={list.door ?? []} buyer={c.buyer} onBuyerChange={c.setBuyer} provider={props.provider} failure={failure} locked={charging} />
      ) : null}
      <Runners props={props} onFailed={onFailed} />
      <RaiseError c={c} onRetry={act} />
      {shown ? (
        <ListBar summary={list.summary} extras={extras} payer={charging ? null : <PayerLine props={props} />} reason={underButton}>
          <BarAction props={props} failure={failure} act={act} reason={reason} />
        </ListBar>
      ) : null}
    </Box>
  );
}
