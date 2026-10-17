import { useMemo, type JSX, type ReactNode } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { buyerFieldsFor } from "./buyer-fields";
import { EmptyCart } from "./checkout-steps";
import { DadosStep } from "./dados-step";
import { PaymentStatus } from "./payment-status";
import type { BackActionEmphasis } from "./payment-status-parts";
import type { BuyerInfo, CheckoutProviderConfig, SettlementCheckout } from "./types";
import { CheckoutCopyProvider } from "./copy-context";
import { useOneClick } from "./one-click";
import { CheckoutComponentsProvider, type CheckoutComponents } from "./ui";
import type { CheckoutViewCopy } from "./view-copy";
import { CheckoutFrame, FlowHeader } from "./checkout-frame";
import type { CheckoutDeliverySummary, CheckoutSummaryLine } from "./payment-summary";
import { useCheckoutController, type CheckoutHostPorts } from "./use-checkout-controller";
import type { CheckoutPaymentList } from "./list/types";
import { PaymentPhase, settlementTotalOverride } from "./payment-phase";


/** What the flow reads off the host's cart — display facts, never money math. */
export interface CheckoutCartView {
  /** Nothing to check out (cart mode only; a settlement settlement ignores it). */
  empty: boolean;
  totalLabel: string;
  totalItems: number;
  /** Host-rendered discount itemization under the pay-bar total (FUT-246). */
  discountLines?: ReactNode;
  /**
   * The cart's lines, worded by the host, for the order summary the Pagamento
   * step shows beside the payment on a computer (FUT-3525). Absent, the
   * summary shows the total alone.
   */
  lines?: CheckoutSummaryLine[];
  /**
   * Where the order is delivered, and the host's way back to change it — set
   * only for a delivery (FUT-3525). Absent, no address is shown.
   */
  delivery?: CheckoutDeliverySummary;
  /** The host's note control, shown in the Pagamento step's summary (FUT-3525). */
  orderNote?: ReactNode;
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
   * remains the way to pay (the one list then offers no Apple Pay at all).
 */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  /** Host content shown on the paid confirmation (the storefront's install invite). */
  confirmationExtra?: ReactNode;
  /**
   * Host illustration that replaces the paid confirmation's icon —
   * `PaymentStatusProps.paidHero`: pass it only when there is one, and mark it `aria-hidden`.
   */
  confirmationHero?: ReactNode;
  /** Host content shown AFTER the confirmation's actions — `PaymentStatusProps.paidFooter`. */
  confirmationFooter?: ReactNode;
  /** Whether the way out leads the paid screen — see {@link BackActionEmphasis}. */
  backActionEmphasis?: BackActionEmphasis;
  /** Design-system slots; unfilled slots render the raw-MUI defaults. */
  components?: Partial<CheckoutComponents>;
  /**
   * Opt-in: the Pagamento step as ONE list (FUT-3591) — the store's online
   * options and the host's door options in one radio group, nothing raised on
   * a pick, the bar's button the only way an order is made, and the card
   * charged after a 5-second bar the buyer can cancel (FUT-3592). The buyer's
   * missing CPF is asked once at the top of the step, above the wallet buttons
   * (FUT-3685), instead of on a Dados step first.
   * Absent: the method tabs, the order summary and raise-on-pick, unchanged.
   * See `./list/types.ts`.
   */
  paymentList?: CheckoutPaymentList;
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
  confirmationHero,
  confirmationFooter,
  backActionEmphasis,
}: {
  copy: CheckoutViewCopy;
  c: ReturnType<typeof useCheckoutController>;
  settlement: SettlementCheckout | null | undefined;
  cart: CheckoutCartView;
  confirmationExtra: ReactNode;
  confirmationHero: ReactNode;
  confirmationFooter: ReactNode;
  backActionEmphasis: BackActionEmphasis | undefined;
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
      paidHero={confirmationHero}
      paidFooter={confirmationFooter}
      backActionEmphasis={backActionEmphasis}
      awaitingTimedOut={c.awaitingTimedOut}
      // How the wait behind this screen is going, and the way out of it
      // (FUT-1144). It is the resumed leg's wait for a checkout that came back
      // from a provider's page, and this step's own (FUT-1170) for one that
      // never left the tab — which used to have no wait at all, and so a
      // spinner that stood for nothing.
      awaitingError={c.awaitingError}
      onCheckAgain={c.awaitingCheckAgain}
      // The buyer's own way out of a hosted wait with no terminal state
      // (FUT-1146). Absent — and so unrendered — until the resumed leg has one
      // to offer, which is every checkout that never left this tab.
      onNotPaid={c.resumeRelease}
      releasing={c.resumeReleasing}
      // WHY a card was refused, when the server said (FUT-1145). Read on
      // FAILED only, where it picks the sentence and decides whether a retry
      // could work at all.
      decline={c.decline}
      // A Pix the store confirms by hand ends without proof either way
      // (FUT-3232), so its refusal and lapse get their own sentences.
      manual={c.order?.pix?.confirmation === "MANUAL"}
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
 *
 * A RAISE IN FLIGHT is not "nothing to pay for" either (FUT-1170). Raising a
 * charge now drops the one it replaces before it asks for the new one, so there
 * is a window with no order held — and a checkout whose cart the host had
 * already emptied would otherwise swap the buyer onto the empty-cart screen
 * mid-regenerate, discarding the charge as it arrived.
 */
function nothingToPayFor(
  settlement: SettlementCheckout | null | undefined,
  cart: CheckoutCartView,
  c: ReturnType<typeof useCheckoutController>,
): boolean {
  if (settlement || !cart.empty || !cartLoaded(cart)) return false;
  return !c.order && !c.creating && c.step !== "status";
}

function CheckoutFlowBody(props: Omit<CheckoutFlowProps, "components">): JSX.Element {
  const { copy, cart, defaultBuyer, settlement, taxIdOnFile = false, providerConfig, tenantSlug, confirmationExtra, confirmationHero, confirmationFooter, backActionEmphasis, oneClick = false, paymentList } = props;
  const ports = { createOrder: props.createOrder, saveBuyerContact: props.saveBuyerContact, onExitToMenu: props.onExitToMenu, onPaid: props.onPaid };
  // Resolved for NO method on purpose (FUT-595): the Dados step opens before
  // the picker, and the form is filled once — so it asks for the union of what
  // any chain member may need rather than re-opening after the choice. A chain
  // that declares nothing degrades to CPF-required, never to "ask nothing".
  const buyerFields = useMemo(() => buyerFieldsFor(providerConfig?.chain, null), [providerConfig]);
  // The list asks a missing CPF inside the option (M11), so it opens on
  // Pagamento as a buyer with one on file always has (FUT-465).
  const c = useCheckoutController(ports, defaultBuyer, taxIdOnFile || Boolean(paymentList), buyerFields, tenantSlug, cart.identity);
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
    <CheckoutFrame payment={c.step === "payment"}>
      {/* In the list, the host's own stepper is the chrome around Pagamento. */}
      {paymentList && c.step === "payment" ? null : (
        <FlowHeader copy={copy} step={c.step} completed={c.completed} onBack={c.back} />
      )}

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

          {c.step === "payment" ? <PaymentPhase props={props} c={c} armed={armed} /> : null}

          {c.step === "status" ? (
            <StatusStep
              copy={copy}
              c={c}
              settlement={settlement}
              cart={cart}
              confirmationExtra={confirmationExtra}
              confirmationHero={confirmationHero}
              confirmationFooter={confirmationFooter}
              backActionEmphasis={backActionEmphasis}
            />
          ) : null}
    </CheckoutFrame>
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
