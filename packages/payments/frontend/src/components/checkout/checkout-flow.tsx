import { Box } from "@mui/material";
import { useMemo, type JSX, type ReactNode } from "react";

import { buyerFieldsFor } from "./buyer-fields";
import { DadosStep, EmptyCart, PaymentStep } from "./checkout-steps";
import { ArrowBackIcon } from "./icons";
import { PaymentStatus } from "./payment-status";
import type { BuyerInfo, CheckoutProviderConfig, ComandaCheckout } from "./types";
import { CheckoutComponentsProvider, useCheckoutComponents, type CheckoutComponents } from "./ui";
import { useCheckoutController, type CheckoutHostPorts } from "./use-checkout-controller";

const STEPPER_STEPS = [
  { id: "dados", label: "Dados" },
  { id: "payment", label: "Pagamento" },
  { id: "status", label: "Confirmação" },
];

/** What the flow reads off the host's cart — display facts, never money math. */
export interface CheckoutCartView {
  /** Nothing to check out (cart mode only; a comanda settlement ignores it). */
  empty: boolean;
  totalLabel: string;
  totalItems: number;
  /** Host-rendered discount itemization under the pay-bar total (FUT-246). */
  discountLines?: ReactNode;
}

/**
 * The full buyer checkout, mounted by a host in one line (FUT-564): the
 * three-step flow — Dados → Pagamento → Confirmação — with the payment step
 * speaking the store's ACTIVE provider protocol (PagBank PIX + card, Stone
 * card, InfinitePay hosted redirect) against the host-mounted `/api/checkout*`
 * surface. Cart, catalog, comanda and order CREATION stay in the host and
 * arrive through {@link CheckoutHostPorts} + {@link CheckoutCartView};
 * pixels render through the slot contract (`components`, see `ui.tsx`).
 */
export interface CheckoutFlowProps extends CheckoutHostPorts {
  /** The host's cart, reduced to what the flow displays. */
  cart: CheckoutCartView;
  defaultBuyer?: BuyerInfo;
  /** Present ⇒ this checkout settles a comanda, not the cart (FUT-comandas). */
  comanda?: ComandaCheckout | null;
  /** The buyer has a CPF saved ⇒ open on Pagamento, skipping Dados (FUT-465). */
  taxIdOnFile?: boolean;
  /** The store's active payment protocol (FUT-697); absent while loading. */
  providerConfig?: CheckoutProviderConfig | null;
  /** Scopes the saved-card list to the store being paid. */
  tenantSlug?: string;
  /**
   * The host's Apple Pay merchant-validation port (FUT-472): exchange the
   * session's `validationURL` for an Apple merchant session, SERVER-SIDE.
   * Optional — without it the Apple Pay sheet cannot start, and the card form
   * remains the way to pay.
   */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  /** Host content shown on the paid confirmation (the storefront's install invite). */
  confirmationExtra?: ReactNode;
  /** Design-system slots; unfilled slots render the raw-MUI defaults. */
  components?: Partial<CheckoutComponents>;
}

/** The pay-bar total override when settling a comanda (else the cart's own totals). */
function comandaTotalOverride(
  comanda: ComandaCheckout | null | undefined,
): { label: string; items: number } | undefined {
  return comanda ? { label: comanda.totalLabel, items: comanda.totalItems } : undefined;
}

/**
 * The facts the confirmation screen shows beside the total (FUT-593): which
 * order this was, and where its receipt went. Its own function so the optional
 * order stays out of the flow body, which sits at its complexity ceiling.
 */
function confirmationFacts(
  order: { orderId: string } | null,
  buyer: BuyerInfo,
): { orderId?: string; buyerEmail?: string } {
  return { orderId: order?.orderId, buyerEmail: buyer.email };
}

/** The confirmation total: the created order's, else the comanda scope's, else the cart's. */
function statusTotalLabel(
  order: { totalLabel: string } | null,
  comanda: ComandaCheckout | null | undefined,
  cart: { totalLabel: string },
): string {
  return order?.totalLabel ?? comanda?.totalLabel ?? cart.totalLabel;
}

/**
 * The slim checkout header — the flow's only nav: a step-aware back link
 * (Pagamento → Dados, else the menu).
 *
 * Deliberately nothing else. A "limpar carrinho" trash used to sit on the right
 * of the Dados step; it was removed because emptying the cart is a CART action
 * and belongs where the cart is edited — the drawer, which already offers a
 * per-line remove. Offering it here put a destructive control next to the form
 * a buyer is filling in, one tap away from the field they are typing into.
 */
function CheckoutHeader({ step, onBack }: { step: string; onBack: () => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ minHeight: 36, display: "flex", alignItems: "center", gap: 1 }}>
      <Button variant="text" color="neutral" size="sm" icon={<ArrowBackIcon fontSize="small" />} iconPosition="left" onClick={onBack} dataTestId="checkout-back">
        {step === "dados" ? "Continuar comprando" : "Voltar"}
      </Button>
    </Box>
  );
}

/** Compact 50px progress header so the form stays above the fold on mobile. */
function ProgressHeader({ step, completed }: { step: string; completed: Set<string> }): JSX.Element {
  const { Stepper } = useCheckoutComponents();
  return (
    <Box sx={{ height: 50, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Stepper steps={STEPPER_STEPS} activeId={step} completed={completed} orientation="horizontal" size="sm" data-testid="checkout-stepper" />
    </Box>
  );
}

/**
 * The 3-step flow body, below the slot provider. Ported from the storefront's
 * app-local checkout (FUT-564): the tenant cart provider lives in the HOST's
 * chrome (reduced to {@link CheckoutCartView} here), and the provider SDK +
 * card public key are loaded lazily by the card path (order-scoped REST).
 */
function CheckoutFlowBody(props: Omit<CheckoutFlowProps, "components">): JSX.Element {
  const { cart, defaultBuyer, comanda, taxIdOnFile = false, providerConfig, tenantSlug, confirmationExtra, validateApplePayMerchant, ...ports } = props;
  // Resolved for NO method on purpose (FUT-595): the Dados step opens before
  // the picker, and the form is filled once — so it asks for the union of what
  // any chain member may need rather than re-opening after the choice. A chain
  // that declares nothing degrades to CPF-required, never to "ask nothing".
  const buyerFields = useMemo(() => buyerFieldsFor(providerConfig?.chain, null), [providerConfig]);
  const c = useCheckoutController(ports, defaultBuyer, taxIdOnFile, buyerFields);

  // A comanda settlement pays already-sent kitchen items — the cart is
  // legitimately empty here, so the empty-cart guard only applies to cart mode.
  //
  // The guard cannot key on the Dados step any more: skipping it (FUT-465) makes
  // Pagamento the first screen, so an empty cart would otherwise reach the
  // method picker. It holds until an order exists — once one does, its lines are
  // snapshotted server-side and the cart no longer speaks for it.
  if (!comanda && cart.empty && !c.order && c.step !== "status") {
    return <EmptyCart onBack={c.goToMenu} />;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: { xs: 2, sm: 3 } }}>
      <CheckoutHeader step={c.step} onBack={c.back} />

      <ProgressHeader step={c.step} completed={c.completed} />

      {c.step === "dados" ? (
        <DadosStep
          buyer={c.buyer}
          onBuyerChange={c.setBuyer}
          saveProfile={c.saveProfile}
          onSaveProfileChange={c.setSaveProfile}
          createError={c.createError}
          errorField={c.errorField}
          onContinue={c.goToPayment}
          cartTotals={cart}
          buyerFields={buyerFields}
          discountLines={cart.discountLines}
          totalOverride={comandaTotalOverride(comanda)}
        />
      ) : null}

      {c.step === "payment" ? (
        <PaymentStep
          method={c.method}
          onMethodChange={c.setMethod}
          order={c.order}
          buyer={c.buyer}
          creating={c.creating}
          createError={c.createError}
          errorField={c.errorField}
          errorCode={c.errorCode}
          onGenerate={(chosen) => void c.startPayment(chosen)}
          onUseEmail={c.payWithEmail}
          // Set only for a skipped-Dados flow (the controller decides); the
          // payer block hides itself when it is absent.
          onEditBuyer={c.editBuyer}
          providerConfig={providerConfig}
          tenantSlug={tenantSlug}
          validateApplePayMerchant={validateApplePayMerchant}
          onResolved={c.handleResolved}
        />
      ) : null}

      {c.step === "status" ? (
        <PaymentStatus
          status={c.finalStatus}
          totalLabel={statusTotalLabel(c.order, comanda, cart)}
          {...confirmationFacts(c.order, c.buyer)}
          onRetry={c.retry}
          onRegenerate={() => { c.setStep("payment"); void c.startPayment("PIX"); }}
          onBackToMenu={c.goToMenu}
          paidExtra={confirmationExtra}
        />
      ) : null}
    </Box>
  );
}

/**
 * The one-line mount: fills the design-system slots, then renders the flow.
 * `<CheckoutFlow cart={...} createOrder={...} onExitToMenu={...} />` is a
 * complete buyer checkout; everything else is optional.
 */
export function CheckoutFlow({ components, ...props }: CheckoutFlowProps): JSX.Element {
  return (
    <CheckoutComponentsProvider components={components}>
      <CheckoutFlowBody {...props} />
    </CheckoutComponentsProvider>
  );
}
