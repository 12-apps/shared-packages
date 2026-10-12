import { Box } from "@mui/material";
import { useEffect, useRef, type JSX, type ReactNode } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { CartChangedBoundary, type OrderRefresh } from "./cart-changed";
import { useCheckoutCopy } from "./copy-context";
import { useMethodChoice } from "./method-choice";
import { PixStageProvider } from "./pix-stage";
import { PayBarTotalProvider, useCheckoutLayout, usePaymentPixStage } from "./payment-step-layout";
import { PaymentErrorPanel } from "./payment-error-panel";
import { PaymentStepFrame, summaryParts } from "./payment-step-frame";
import type { CheckoutDeliverySummary, CheckoutSummaryLine, OrderSummaryParts } from "./payment-summary";
import { resolveCheckoutScreen } from "./providers/registry";
import type {
  BuyerField,
  BuyerInfo,
  CheckoutOrder,
  CheckoutProviderConfig,
  OnCheckoutResolved,
  PaymentMethod,
} from "./types";
import type { EmptyCartCopy } from "./view-copy";
import { useCheckoutComponents } from "./ui";

/**
 * Auto-raise the order once per method-while-orderless (the ref also absorbs
 * StrictMode's double-effect, so PIX never double-charges); a failure sets
 * `createError` which stops the loop until the buyer retries.
 */
function useAutoRaiseOrder(
  order: CheckoutOrder | null,
  method: PaymentMethod | null,
  creating: boolean,
  createError: string | null,
  onGenerate: (method: PaymentMethod) => void,
): void {
  const requestedFor = useRef<PaymentMethod | null>(null);
  useEffect(() => {
    if (order) {
      requestedFor.current = null;
      return;
    }
    // No method chosen yet ⇒ show only the picker (or, for a hand-off store,
    // its "Seguir para o pagamento"); raise the order once the buyer commits.
    if (!method || creating || createError || requestedFor.current === method) return;
    requestedFor.current = method;
    onGenerate(method);
  }, [method, order, creating, createError, onGenerate]);
}

/**
 * The payment body — whichever screen the store's provider declares (FUT-596).
 *
 * This used to switch on `order.method` and compose the PIX and card panes
 * itself. It now resolves a screen from the id the adapter published on the
 * chain's head and renders it; the panes moved to `providers/`, unchanged.
 * The shell keeps everything shared — picker, payer, totals, errors, the
 * polling cadence — so a provider's flow differs only where it genuinely does.
 *
 * `resolveCheckoutScreen` always returns a component, so there is no branch
 * here for "no screen": an undeclared or unrecognised id lands on the
 * capability default.
 */
function PaymentBody({
  order,
  buyer,
  providerConfig,
  method,
  tenantSlug,
  onResolved,
  onStart,
  creating,
  pollIntervalMs,
  freshInstrument,
  basket,
  validateApplePayMerchant,
}: {
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  providerConfig: CheckoutProviderConfig | null;
  method: PaymentMethod | null;
  tenantSlug?: string;
  onResolved: OnCheckoutResolved;
  /** Set only when the shell hid its picker — see {@link PaymentStep}. */
  onStart?: () => void;
  creating: boolean;
  pollIntervalMs?: number;
  freshInstrument?: boolean;
  basket?: CheckoutBasketIdentity;
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
}): JSX.Element | null {
  const Screen = resolveCheckoutScreen(providerConfig?.chain?.[0]?.checkoutScreen);
  return (
    <Screen
      order={order}
      buyer={buyer}
      config={providerConfig}
      method={method}
      tenantSlug={tenantSlug}
      onResolved={onResolved}
      onStart={onStart}
      creating={creating}
      pollIntervalMs={pollIntervalMs}
      freshInstrument={freshInstrument}
      basket={basket}
      validateApplePayMerchant={validateApplePayMerchant}
    />
  );
}

/** Empty-cart state shown when there's nothing to check out. */
export function EmptyCart({ copy, onBack }: { copy: EmptyCartCopy; onBack: () => void }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  return (
    <Box data-testid="checkout-empty" sx={{ py: 8, textAlign: "center", display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
      <Text variant="heading" size="md" as="p">
        {copy.title}
      </Text>
      <Button variant="solid" color="primary" size="md" onClick={onBack} dataTestId="checkout-empty-back">
        {copy.action}
      </Button>
    </Box>
  );
}

/** Props for {@link PaymentStep} — step 2's inputs, wired by the flow. */
interface PaymentStepProps {
  method: PaymentMethod | null;
  onMethodChange: (method: PaymentMethod) => void;
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  creating: boolean;
  createError: string | null;
  errorField: BuyerField | null;
  /**
   * The refusal's machine code (FUT-563). An UNRESOLVED charge is not a failed
   * one — the panel below must not offer to raise a second.
 */
  errorCode?: string | null;
  onGenerate: (method: PaymentMethod) => void;
  /**
   * Re-price the raised order IN PLACE, keeping the card form (FUT-1139). Absent,
   * the step falls back to raising the payment again.
   */
  refresh?: OrderRefresh;
  onUseEmail: (email: string) => void;
  /**
   * Present ⇒ the buyer reached this step without a Dados step (FUT-465), so
   * the payer block states who is being charged and reopens Dados to change it.
 */
  onEditBuyer?: () => void;
  /**
   * The store's active payment protocol (`GET /api/checkout/config`, FUT-697).
   * `null` while loading or on a transient fetch failure — methods then render
   * as before and the card path degrades to the PagBank per-order key refresh,
   * WITHOUT mock permission (fail-open for the UI, fail-closed for the money).
 */
  providerConfig?: CheckoutProviderConfig | null;
  /** Scopes the saved-card list to the store being paid (host routing owns it). */
  tenantSlug?: string;
  /**
   * WHAT THE BUYER IS ABOUT TO PAY (FUT-1179) — the host cart's own totals, or
   * the settlement's where one is being settled.
   *
   * The Pagamento step showed no amount at all before a method was chosen, and
   * a store that finishes on the provider's page sent a buyer with a CPF on
   * file straight out to that provider with NO total ever having been on
   * screen: the flow opens on Pagamento, the hand-off screen owns the only
   * button, and the amount lived exclusively on the Dados step they skipped.
   * Asking for money without showing the amount is the one thing a checkout
   * may not do.
   *
   * Optional so a host composing this step by hand is not broken by the
   * addition; absent, the step renders as it did.
   */
  cartTotals?: { totalLabel: string; totalItems: number };
  /** Settling an open balance: totals come from the settlement, not the cart. */
  totalOverride?: { label: string; items: number };
  /** The host's own rendered discount itemization, under the total (FUT-246). */
  discountLines?: ReactNode;
  /** The cart's lines, listed in the computer's order summary (FUT-3525). */
  lines?: CheckoutSummaryLine[];
  /** Where a delivery goes — Entrega only; absent hides the row (FUT-3525). */
  delivery?: CheckoutDeliverySummary;
  /** The host's note control, shown in the summary (FUT-3525). */
  orderNote?: ReactNode;
  pollIntervalMs?: number;
  /** Retrying a refused card — preselect no saved instrument (FUT-1145). */
  freshInstrument?: boolean;
  /**
   * WHICH basket this checkout is for (FUT-1213) — passed down because the
   * card path can park an order too: a 3-D Secure challenge is a hand-off, and
   * one parked without a basket resumes over any basket at any store, which is
   * this ticket's own bug on a sibling path.
   */
  basket?: CheckoutBasketIdentity;
  /** The host's Apple Pay merchant-validation port (FUT-472) — see the screen contract. */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  onResolved: OnCheckoutResolved;
}

export function PaymentStep({
  method,
  onMethodChange,
  order,
  buyer,
  creating,
  createError,
  errorField,
  errorCode,
  onGenerate,
  refresh,
  onUseEmail,
  onEditBuyer,
  providerConfig,
  tenantSlug,
  cartTotals,
  totalOverride,
  discountLines,
  lines,
  delivery,
  orderNote,
  pollIntervalMs,
  freshInstrument,
  basket,
  validateApplePayMerchant,
  onResolved,
}: PaymentStepProps): JSX.Element {
  const config = providerConfig ?? null;
  const choice = useMethodChoice(config, method, onMethodChange);
  useAutoRaiseOrder(order, method, creating, createError, onGenerate);
  const pixStage = usePaymentPixStage(choice, onMethodChange);

  const wide = useCheckoutLayout()?.wide ?? false;
  const parts = summaryParts(
    { order, cartTotals, totalOverride, discountLines },
    { lines, payer: payerOf(buyer, onEditBuyer), delivery, orderNote },
  );
  const tabs = {
    show: !(choice.atProvider || pixStage.afterCopy),
    method,
    onChange: onMethodChange,
    cardUnavailable: choice.cardUnavailable,
    offered: choice.offered,
  };

  return (
    <PixStageProvider stage={pixStage}>
      <PayBarTotalProvider value={parts?.totalLabel ?? null}>
        <PaymentStepFrame wide={wide} parts={parts} tabs={tabs} filled={Boolean(method || order)}>
          <CartChangedBoundary {...{ order, creating, onGenerate, refresh }} basket={totalOverride ? undefined : basket}>
            <PaymentBody
              order={order}
              buyer={buyer}
              providerConfig={config}
              method={method}
              tenantSlug={tenantSlug}
              onResolved={onResolved}
              onStart={choice.onStart}
              creating={creating}
              pollIntervalMs={pollIntervalMs}
              freshInstrument={freshInstrument}
              basket={basket}
              validateApplePayMerchant={validateApplePayMerchant}
            />
          </CartChangedBoundary>
          <RaisingState
            order={order}
            method={method}
            creating={creating && !choice.atProvider}
            createError={createError}
            errorField={errorField}
            errorCode={errorCode}
            onUseEmail={onUseEmail}
            onGenerate={onGenerate}
          />
        </PaymentStepFrame>
      </PayBarTotalProvider>
    </PixStageProvider>
  );
}

/** The payer line's facts — only for a flow whose Dados step was skipped (FUT-465). */
function payerOf(buyer: BuyerInfo, onEditBuyer: (() => void) | undefined): OrderSummaryParts["payer"] {
  return onEditBuyer ? { name: buyer.name, taxId: buyer.taxId, onEdit: onEditBuyer } : undefined;
}

/**
 * What the shell says while the order is being raised, and if raising it
 * failed.
 *
 * The spinner is SUPPRESSED for a hand-off screen — that screen renders its own
 * "Preparando o pagamento" while the charge is raised, and two stacked spinners
 * saying the same thing is what the buyer actually saw. The caller decides
 * that; here `creating` is simply true or false.
 */
function RaisingState({
  order,
  method,
  creating,
  createError,
  errorField,
  errorCode,
  onUseEmail,
  onGenerate,
}: {
  order: CheckoutOrder | null;
  method: PaymentMethod | null;
  creating: boolean;
  createError: string | null;
  errorField: BuyerField | null;
  errorCode?: string | null;
  onUseEmail: (email: string) => void;
  onGenerate: (method: PaymentMethod) => void;
}): JSX.Element | null {
  const { LoadingState } = useCheckoutComponents();
  const screens = useCheckoutCopy().screens;
  if (order) return null;
  if (creating) {
    return (
      <LoadingState
        variant="spinner"
        size="md"
        message={screens.generatingPayment}
        dataTestId="payment-generating"
      />
    );
  }
  if (!method || !createError) return null;
  return (
    <PaymentErrorPanel
      message={createError}
      emailFlagged={errorField === "email"}
      code={errorCode}
      onUseEmail={onUseEmail}
      onRetry={() => onGenerate(method)}
    />
  );
}
