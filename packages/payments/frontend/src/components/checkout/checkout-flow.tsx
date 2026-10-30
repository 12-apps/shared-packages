import type { JSX, ReactNode } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { EmptyCart } from "./empty-cart";
import { PaymentStatus } from "./payment-status";
import type { BackActionEmphasis } from "./payment-status-parts";
import type { BuyerInfo, CheckoutProviderConfig, SettlementCheckout } from "./types";
import { CheckoutCopyProvider } from "./copy-context";
import { HostedParkingContext } from "./hosted-parking";
import { CheckoutComponentsProvider, type CheckoutComponents } from "./ui";
import type { CheckoutViewCopy } from "./view-copy";
import { CheckoutFrame } from "./checkout-frame";
import type { CheckoutDeliverySummary, CheckoutSummaryLine } from "./payment-summary";
import { useCheckoutController, type CheckoutHostPorts } from "./use-checkout-controller";
import type { CheckoutPaymentList } from "./list/types";
import { PaymentPhase } from "./payment-phase";


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
 * The full buyer checkout, mounted by a host in one line (FUT-564): Pagamento
 * as the ONE payment list, then Confirmação (FUT-4028), with the payment
 * speaking the store's ACTIVE provider protocol (PagBank PIX + card, Stone
 * card, InfinitePay hosted redirect) against the host-mounted `/api/checkout*`
 * surface. Cart, catalog, settlement and order CREATION stay in the host and
 * arrive through {@link CheckoutHostPorts} + {@link CheckoutCartView};
 * pixels render through the slot contract (`components`, see `ui.tsx`).
 */
export interface CheckoutFlowProps extends CheckoutHostPorts {
  /**
   * Every sentence the flow's own chrome renders — the consent line, the
   * empty cart, the confirmation screen. REQUIRED, with no default:
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
  /** The buyer has a CPF saved ⇒ the list shows the payer line, not the CPF field (FUT-465). */
  taxIdOnFile?: boolean;
  /**
   * WHICH document is on file, when the host knows (FUT-4080). The payer line
   * reads the kind from the document typed in the list, and a buyer with one on
   * file typed none — a host never hands the digits over — so without this a
   * saved CNPJ reads "CPF ✓". Absent ⇒ the copy's own fallback.
   */
  taxIdKindOnFile?: "CPF" | "CNPJ" | null;
  /** The store's active payment protocol (FUT-697); absent while loading. */
  providerConfig?: CheckoutProviderConfig | null;
  /** Scopes the saved-card list to the store being paid. */
  tenantSlug?: string;
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
   * The Pagamento step, which is ONE list (FUT-3591, required since FUT-4028):
   * the store's online options and the host's door options in one radio
   * group, nothing raised on a pick, the bar's button the only way an order is
   * made, and the card charged after a 5-second bar the buyer can cancel
   * (FUT-3592). The buyer's missing CPF is asked once at the top of the step,
   * above the wallet buttons (FUT-3685). See `./list/types.ts`.
   */
  paymentList: CheckoutPaymentList;
  /**
   * `false` keeps this mount out of the tab's parked-payment slot: it neither
   * parks what it raises, nor resumes, nor forgets what the host's checkout
   * parked. For a second mount that pays something the host tracks itself (a
   * pedido paid again from its own page). Default `true`. See
   * `./hosted-parking.ts`.
   */
  parkHostedOrders?: boolean;
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
 * there. Pagamento is the first screen, so the guard keys on the order: it
 * holds until an order exists — once
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

/**
 * The flow body, below the slot provider: Pagamento (the one list), then the
 * confirmation. Ported from the storefront's app-local checkout (FUT-564): the
 * cart lives in the HOST (reduced to {@link CheckoutCartView} here), and the
 * provider SDK + card public key are loaded lazily by the card path.
 */
function CheckoutFlowBody(props: Omit<CheckoutFlowProps, "components">): JSX.Element {
  const { copy, cart, defaultBuyer, settlement, tenantSlug, confirmationExtra, confirmationHero, confirmationFooter, backActionEmphasis } = props;
  const ports = { createOrder: props.createOrder, saveBuyerContact: props.saveBuyerContact, onExitToMenu: props.onExitToMenu, onPaid: props.onPaid };
  // The list asks a missing CPF at the top of Pagamento, so the controller
  // always opens there (FUT-465, FUT-4028).
  const c = useCheckoutController(ports, defaultBuyer, tenantSlug, cart.identity);

  // A settlement pays already-sent kitchen items — the cart is legitimately
  // empty there, so the empty-cart guard only applies to cart mode. It holds
  // until an order exists: once one does, its lines are snapshotted
  // server-side and the cart no longer speaks for it.
  if (nothingToPayFor(settlement, cart, c)) {
    return <EmptyCart copy={copy.emptyCart} onBack={c.goToMenu} />;
  }

  // The host's own stepper is the chrome around every step it shows, the paid
  // confirmation included: no second "Etapa N de M" nested in the host's card,
  // and no "Voltar" into a payment that already happened (FUT-3999).
  return (
    <CheckoutFrame payment={c.step === "payment"}>
      {c.step === "payment" ? <PaymentPhase props={props} c={c} /> : null}

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
export function CheckoutFlow({ components, parkHostedOrders = true, ...props }: CheckoutFlowProps): JSX.Element {
  return (
    <CheckoutComponentsProvider components={components}>
      <CheckoutCopyProvider copy={props.copy.screens}>
        <HostedParkingContext.Provider value={parkHostedOrders}>
          <CheckoutFlowBody {...props} />
        </HostedParkingContext.Provider>
      </CheckoutCopyProvider>
    </CheckoutComponentsProvider>
  );
}
