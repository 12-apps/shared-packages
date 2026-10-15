import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import type { CheckoutBasketIdentity } from "../basket";
import { CartChangedBoundary } from "../cart-changed";
import { displayTotals } from "../checkout-totals";
import { usePaymentPixStage } from "../payment-step-layout";
import { PixStageProvider } from "../pix-stage";
import { PixView } from "../pix-view";
import { HostedLinkScreen } from "../providers/hosted-link";
import type { BuyerContact, BuyerInfo, CheckoutProviderConfig, PaymentMethod } from "../types";
import type { useCheckoutController } from "../use-checkout-controller";

import { PaymentListProvider } from "./context";
import { ListBar, WaitingLine } from "./list-bar";
import { ListFace } from "./list-face";
import type { ListCapability } from "./use-capability";
import type { ListCharge } from "./use-list-charge";
import type { ListState } from "./use-list-state";
import type { CheckoutPaymentList } from "./types";
import { useListCapability } from "./use-capability";
import { useListCharge } from "./use-list-charge";
import { useListState } from "./use-list-state";

type Controller = ReturnType<typeof useCheckoutController>;

interface PaymentListStepProps {
  c: Controller;
  list: CheckoutPaymentList;
  cart: { totalLabel: string; totalItems: number; identity?: CheckoutBasketIdentity };
  /** Settling a balance: its totals win, and its basket is no signal. */
  totalOverride?: { label: string; items: number };
  providerConfig: CheckoutProviderConfig | null | undefined;
  tenantSlug: string | undefined;
  taxIdOnFile: boolean;
  /** What the buyer arrived with — the asked fields are decided against it. */
  defaultBuyer: BuyerInfo | undefined;
  saveBuyerContact?: (contact: BuyerContact) => void;
  /** The Dados step's consent sentence — the list asks it beside the details it asks. */
  consentLabel: string;
  pollIntervalMs?: number;
}

/** The store's provider name, as its chain head published it — `null` when it did not. */
function providerName(config: CheckoutProviderConfig | null): string | null {
  return config?.chain?.[0]?.displayName?.trim() || null;
}

/** "Abrindo a página da InfinitePay…": the hand-off is under way, the bar says what it waits for. */
function HandOffFace({ props, method }: { props: PaymentListStepProps; method: PaymentMethod }): JSX.Element {
  const config = props.providerConfig ?? null;
  const { c, list } = props;
  return (
    <>
      <HostedLinkScreen order={null} buyer={c.buyer} config={config} method={method} onResolved={c.handleResolved} />
      <ListBar summary={list.summary}>
        <WaitingLine text={list.copy.handOffWaiting(providerName(config))} />
      </ListBar>
    </>
  );
}

/** The hand-off was started, until the raise for it is refused. */
function useHandingOff(createError: string | null): [boolean, () => void] {
  const [handingOff, setHandingOff] = useState(false);
  useEffect(() => {
    if (createError) setHandingOff(false);
  }, [createError]);
  return [handingOff, useCallback(() => setHandingOff(true), [])];
}

/** "Prefere pagar com cartão?" — back to the list, with that method chosen. */
function usePreferMethod(c: Controller, choose: ListState["choose"]): (method: PaymentMethod) => void {
  const { setMethod } = c;
  return useCallback(
    (method: PaymentMethod) => {
      setMethod(method);
      choose({ kind: "online", method: method === "PIX" ? "PIX" : "CARD" });
    },
    [setMethod, choose],
  );
}

/** The list face, with what the step gathered for it. */
function ListFaceFor({ props, state, charge, cap, onHandOff }: {
  props: PaymentListStepProps;
  state: ListState;
  charge: ListCharge;
  cap: ListCapability;
  onHandOff: () => void;
}): JSX.Element {
  const { c, cart, totalOverride } = props;
  const config = props.providerConfig ?? null;
  return (
    <ListFace
      c={c}
      list={props.list}
      state={state}
      charge={charge}
      cap={cap}
      config={config}
      total={displayTotals(totalOverride, cart).label}
      provider={providerName(config)}
      taxIdOnFile={props.taxIdOnFile}
      tenantSlug={props.tenantSlug}
      basket={totalOverride ? undefined : cart.identity}
      pollIntervalMs={props.pollIntervalMs ?? 2500}
      saveBuyerContact={props.saveBuyerContact}
      onHandOff={onHandOff}
    />
  );
}

/**
 * The Pagamento step as ONE list (FUT-3591, FUT-3592) — see `./types.ts`.
 *
 * Three faces, chosen from what the controller holds: the raised PIX (its code
 * and the wait), a hand-off on its way to the provider's page, and otherwise
 * the list with its bar. Nothing here raises on a pick; the bar's button is
 * the only way an order is made, and the card's 5-second bar is the buyer's
 * chance to stop it (no confirmation dialog: owner, 2026-10-14).
 */
export function PaymentListStep(props: PaymentListStepProps): JSX.Element {
  const { c, list } = props;
  const config = props.providerConfig ?? null;
  const cap = useListCapability(config, list.totalCents);
  const state = useListState({
    config,
    capability: cap,
    tenantSlug: props.tenantSlug,
    fresh: c.freshInstrument,
    arrivedWith: props.defaultBuyer,
    taxIdOnFile: props.taxIdOnFile,
    onChoiceChange: list.onChoiceChange,
  });
  const charge = useListCharge({ ...c, cartTotal: displayTotals(props.totalOverride, props.cart).label });
  const [handingOff, startHandOff] = useHandingOff(c.createError);
  const pixStage = usePaymentPixStage(cap, usePreferMethod(c, state.choose));
  const pix = c.order?.method === "PIX" ? c.order : null;
  const consent = useMemo(
    () => ({ label: props.consentLabel, checked: c.saveProfile, onChange: c.setSaveProfile }),
    [props.consentLabel, c.saveProfile, c.setSaveProfile],
  );
  const face = pix ? (
    <PixView order={pix} onResolved={c.handleResolved} pollIntervalMs={props.pollIntervalMs} />
  ) : handingOff ? (
    <HandOffFace props={props} method={c.method ?? "PIX"} />
  ) : (
    <ListFaceFor props={props} state={state} charge={charge} cap={cap} onHandOff={startHandOff} />
  );
  return (
    <PaymentListProvider list={list} onLeavePix={c.dropOrder} consent={consent}>
      <PixStageProvider stage={pixStage}>
        <CartChangedBoundary
          order={c.order}
          creating={c.creating}
          onGenerate={(method) => void c.startPayment(method)}
          refresh={c.refresh}
          basket={props.totalOverride ? undefined : props.cart.identity}
          actionInBar={Boolean(pix)}
        >
          {face}
        </CartChangedBoundary>
      </PixStageProvider>
    </PaymentListProvider>
  );
}
