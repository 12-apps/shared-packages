import { Box } from "@mui/material";
import { useMemo, type JSX, type ReactNode } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { buyerFieldsFor } from "./buyer-fields";
import { EmptyCart, PaymentStep } from "./checkout-steps";
import { DadosStep } from "./dados-step";
import { ArrowBackIcon } from "./icons";
import { PaymentStatus } from "./payment-status";
import type { BuyerInfo, CheckoutProviderConfig, SettlementCheckout } from "./types";
import { CheckoutCopyProvider } from "./copy-context";
import { OneClickProvider, useOneClick } from "./one-click";
import { CheckoutComponentsProvider, useCheckoutComponents, type CheckoutComponents } from "./ui";
import type { CheckoutViewCopy } from "./view-copy";
import { useCheckoutController, type CheckoutHostPorts } from "./use-checkout-controller";

/** Step ids are the flow's own contract; the labels beside them are host copy. */
function stepperSteps(copy: CheckoutViewCopy): { id: string; label: string }[] {
  return [
    { id: "dados", label: copy.steps.dados },
    { id: "payment", label: copy.steps.payment },
    { id: "status", label: copy.steps.status },
  ];
}

/** What the flow reads off the host's cart — display facts, never money math. */
export interface CheckoutCartView {
  /** Nothing to check out (cart mode only; a settlement settlement ignores it). */
  empty: boolean;
  totalLabel: string;
  totalItems: number;
  /** Host-rendered discount itemization under the pay-bar total (FUT-246). */
  discountLines?: ReactNode;
  /**
   * WHICH basket this is, so a payment raised from another one cannot resume
   * itself over it (FUT-1213).
   *
   * Optional, and absent means the pre-1213 behaviour — a parked payment
   * resumes on whatever checkout mounts next, which is what shipped and what
   * this ticket exists to bound. A host supplies it by calling
   * `basketSignature(lines)` on its own cart and passing `ready: false` while
   * that cart is still loading; see `./basket.ts` for why the identity is the
   * LINES and not the cart's id.
   */
  identity?: CheckoutBasketIdentity;
}

/**
 * The full buyer checkout, mounted by a host in one line (FUT-564): the
 * three-step flow — Dados → Pagamento → Confirmação — with the payment step
 * speaking the store's ACTIVE provider protocol (PagBank PIX + card, Stone
 * card, InfinitePay hosted redirect) against the host-mounted `/api/checkout*`
 * surface. Cart, catalog, settlement and order CREATION stay in the host and
 * arrive through {@link CheckoutHostPorts} + {@link CheckoutCartView};
 * pixels render through the slot contract (`components`, see `ui.tsx`).
 */
export interface CheckoutFlowProps extends CheckoutHostPorts {
  /**
   * Every sentence the flow's own chrome renders — stepper labels, the Dados
   * step, the empty cart, the confirmation screen. REQUIRED, with no default:
   * a pt-BR host passes `PT_BR_CHECKOUT_VIEW_COPY` from the package root by
   * hand, so choosing Portuguese is a line in the host's diff, never a
   * silence (FUT-760's doctrine, finally applied to the legacy flow too).
   */
  copy: CheckoutViewCopy;
  /** The host's cart, reduced to what the flow displays. */
  cart: CheckoutCartView;
  defaultBuyer?: BuyerInfo;
  /** Present ⇒ this checkout settles an open balance, not the cart . */
  settlement?: SettlementCheckout | null;
  /** The buyer has a CPF saved ⇒ open on Pagamento, skipping Dados (FUT-465). */
  taxIdOnFile?: boolean;
  /** The store's active payment protocol (FUT-697); absent while loading. */
  providerConfig?: CheckoutProviderConfig | null;
  /** Scopes the saved-card list to the store being paid. */
  tenantSlug?: string;
  /**
   * The buyer pressed a BUY button rather than opening a checkout — pay with
   * their saved card and land them on Confirmação, with no tap in between.
   *
   * A REQUEST, never an instruction: it is honoured only where it can be, and
   * degrades to the ordinary flow everywhere else — a store that finishes on
   * the provider's page, a buyer with no CPF on file, a buyer with no saved
   * card. See `./one-click.tsx` for the whole decision and why every clause
   * narrows toward standing down.
   */
  oneClick?: boolean;
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

/**
 * Whether the host's cart has actually answered yet.
 *
 * `true` for every host that wires no identity, which is what it meant before
 * there was one to wire.
 */
function cartLoaded(cart: CheckoutCartView): boolean {
  return cart.identity?.ready !== false;
}

/** The pay-bar total override when settling a settlement (else the cart's own totals). */
function settlementTotalOverride(
  settlement: SettlementCheckout | null | undefined,
): { label: string; items: number } | undefined {
  return settlement ? { label: settlement.totalLabel, items: settlement.totalItems } : undefined;
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

/** The confirmation total: the created order's, else the settlement scope's, else the cart's. */
function statusTotalLabel(
  order: { totalLabel: string } | null,
  settlement: SettlementCheckout | null | undefined,
  cart: { totalLabel: string },
): string {
  return order?.totalLabel ?? settlement?.totalLabel ?? cart.totalLabel;
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
function CheckoutHeader({ copy, step, onBack }: { copy: CheckoutViewCopy; step: string; onBack: () => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ minHeight: 36, display: "flex", alignItems: "center", gap: 1 }}>
      <Button variant="text" color="neutral" size="sm" icon={<ArrowBackIcon fontSize="small" />} iconPosition="left" onClick={onBack} dataTestId="checkout-back">
        {step === "dados" ? copy.dados.keepShopping : copy.dados.back}
      </Button>
    </Box>
  );
}

/** Compact 50px progress header so the form stays above the fold on mobile. */
function ProgressHeader({ copy, step, completed }: { copy: CheckoutViewCopy; step: string; completed: Set<string> }): JSX.Element {
  const { Stepper } = useCheckoutComponents();
  return (
    <Box sx={{ height: 50, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Stepper steps={stepperSteps(copy)} activeId={step} completed={completed} orientation="horizontal" size="sm" data-testid="checkout-stepper" />
    </Box>
  );
}

/**
 * The 3-step flow body, below the slot provider. Ported from the storefront's
 * app-local checkout (FUT-564): the tenant cart provider lives in the HOST's
 * chrome (reduced to {@link CheckoutCartView} here), and the provider SDK +
 * card public key are loaded lazily by the card path (order-scoped REST).
 */
/** Step 3, with the controller's facts mapped onto the status screen. */
function StatusStep({
  copy,
  c,
  settlement,
  cart,
  confirmationExtra,
}: {
  copy: CheckoutViewCopy;
  c: ReturnType<typeof useCheckoutController>;
  settlement: SettlementCheckout | null | undefined;
  cart: CheckoutCartView;
  confirmationExtra: ReactNode;
}): JSX.Element {
  return (
    <PaymentStatus
      copy={copy.status}
      status={c.finalStatus}
      totalLabel={statusTotalLabel(c.order, settlement, cart)}
      {...confirmationFacts(c.order, c.buyer)}
      onRetry={c.retry}
      onRegenerate={() => { c.setStep("payment"); void c.startPayment("PIX"); }}
      onBackToMenu={c.goToMenu}
      paidExtra={confirmationExtra}
      awaitingTimedOut={c.resumeTimedOut}
      // The resumed leg's own trouble, and the way out of it (FUT-1144). Both
      // are inert for a checkout that never left this tab — nothing was parked,
      // so nothing is being polled here.
      awaitingError={c.resumeError}
      onCheckAgain={c.resumeCheckAgain}
      // The buyer's own way out of a hosted wait with no terminal state
      // (FUT-1146). Absent — and so unrendered — until the resumed leg has one
      // to offer, which is every checkout that never left this tab.
      onNotPaid={c.resumeRelease}
      releasing={c.resumeReleasing}
      // WHY a card was refused, when the server said (FUT-1145). Read on
      // FAILED only, where it picks the sentence and decides whether a retry
      // could work at all.
      decline={c.decline}
    />
  );
}

/**
 * Nothing to check out — and the cart has ANSWERED, which is the half FUT-1213
 * added.
 *
 * A settlement pays already-sent items, so the cart is legitimately empty
 * there. The guard cannot key on the Dados step either: skipping it (FUT-465)
 * makes Pagamento the first screen. And it holds until an order exists — once
 * one does, its lines are snapshotted server-side and the cart no longer speaks
 * for it.
 *
 * A cart still being FETCHED is empty in exactly the way a real one is not, so
 * a host that wires `identity` gets this screen when its cart is empty rather
 * than when it is late — which is also the moment the resume decision waits for.
 */
function nothingToPayFor(
  settlement: SettlementCheckout | null | undefined,
  cart: CheckoutCartView,
  c: ReturnType<typeof useCheckoutController>,
): boolean {
  if (settlement || !cart.empty || !cartLoaded(cart)) return false;
  return !c.order && c.step !== "status";
}

/** Step 2, with the controller's facts and the host's money mapped onto it. */
function PagamentoStep({
  c,
  cart,
  settlement,
  providerConfig,
  tenantSlug,
  validateApplePayMerchant,
}: {
  c: ReturnType<typeof useCheckoutController>;
  cart: CheckoutCartView;
  settlement: SettlementCheckout | null | undefined;
  providerConfig: CheckoutProviderConfig | null | undefined;
  tenantSlug: string | undefined;
  validateApplePayMerchant: ((validationURL: string) => Promise<unknown>) | undefined;
}): JSX.Element {
  return (
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
      // Set only for a skipped-Dados flow (the controller decides); the payer
      // block hides itself when it is absent.
      onEditBuyer={c.editBuyer}
      providerConfig={providerConfig}
      tenantSlug={tenantSlug}
      // The amount, on the step that asks for it (FUT-1179).
      cartTotals={cart}
      totalOverride={settlementTotalOverride(settlement)}
      discountLines={cart.discountLines}
      // Retrying a refused card: the saved card that failed is not chosen for
      // them again (FUT-1145).
      freshInstrument={c.freshInstrument}
      // The card path parks an order of its own for a 3-D Secure challenge, so
      // it needs the same basket the flow was mounted for (FUT-1213).
      basket={cart.identity}
      validateApplePayMerchant={validateApplePayMerchant}
      onResolved={c.handleResolved}
    />
  );
}

function CheckoutFlowBody(props: Omit<CheckoutFlowProps, "components">): JSX.Element {
  const { copy, cart, defaultBuyer, settlement, taxIdOnFile = false, providerConfig, tenantSlug, confirmationExtra, validateApplePayMerchant, oneClick = false, ...ports } = props;
  // Resolved for NO method on purpose (FUT-595): the Dados step opens before
  // the picker, and the form is filled once — so it asks for the union of what
  // any chain member may need rather than re-opening after the choice. A chain
  // that declares nothing degrades to CPF-required, never to "ask nothing".
  const buyerFields = useMemo(() => buyerFieldsFor(providerConfig?.chain, null), [providerConfig]);
  const c = useCheckoutController(ports, defaultBuyer, taxIdOnFile, buyerFields, tenantSlug, cart.identity);
  const armed = useOneClick({ requested: oneClick, config: providerConfig, taxIdOnFile, step: c.step, method: c.method, setMethod: c.setMethod });

  // A settlement settlement pays already-sent kitchen items — the cart is
  // legitimately empty here, so the empty-cart guard only applies to cart mode.
  //
  // The guard cannot key on the Dados step any more: skipping it (FUT-465) makes
  // Pagamento the first screen, so an empty cart would otherwise reach the
  // method picker. It holds until an order exists — once one does, its lines are
  // snapshotted server-side and the cart no longer speaks for it.
  if (nothingToPayFor(settlement, cart, c)) {
    return <EmptyCart copy={copy.emptyCart} onBack={c.goToMenu} />;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: { xs: 2, sm: 3 } }}>
      <CheckoutHeader copy={copy} step={c.step} onBack={c.back} />

      <ProgressHeader copy={copy} step={c.step} completed={c.completed} />

      {c.step === "dados" ? (
        <DadosStep
          copy={copy.dados}
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
          totalOverride={settlementTotalOverride(settlement)}
        />
      ) : null}

      {c.step === "payment" ? (
        <OneClickProvider armed={armed}>
          <PagamentoStep
            c={c}
            cart={cart}
            settlement={settlement}
            providerConfig={providerConfig}
            tenantSlug={tenantSlug}
            validateApplePayMerchant={validateApplePayMerchant}
          />
        </OneClickProvider>
      ) : null}

      {c.step === "status" ? (
        <StatusStep copy={copy} c={c} settlement={settlement} cart={cart} confirmationExtra={confirmationExtra} />
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
      <CheckoutCopyProvider copy={props.copy.screens}>
        <CheckoutFlowBody {...props} />
      </CheckoutCopyProvider>
    </CheckoutComponentsProvider>
  );
}
