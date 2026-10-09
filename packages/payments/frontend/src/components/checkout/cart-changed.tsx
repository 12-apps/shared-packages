import { Box } from "@mui/material";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { useCheckoutCopy } from "./copy-context";
import type {
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  CreateOrderResult,
  PaymentMethod,
} from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * THE CART MOVED UNDER A PREPARED PAYMENT (FUT-1139).
 *
 * An order is raised the moment the buyer picks a method, and it prices the
 * cart as it stood THEN. Another tab can add a line, a store can move a price,
 * a product can stop selling — and the card charge or the PIX code on screen
 * still asks for the old amount. Paying it settles the old order and the
 * server closes the cart, so whatever changed was neither charged nor kept.
 *
 * Two halves, both here:
 *
 * - the SERVER refuses a card charge whose order no longer matches the cart,
 *   with {@link CART_CHANGED_CODE}, after re-pricing the order to the cart as it
 *   stands. The card form then re-reads that order, so the pay bar shows the
 *   amount that will actually be charged before the buyer presses it again;
 * - the SCREEN notices on its own that the basket it was raised from is not the
 *   basket in front of it (the host's signature, `./basket.ts`), and says so
 *   with one control that brings the payment up to date. That is the only
 *   warning a PIX buyer can get: a QR code is paid outside the app.
 */

/** The refusal a host answers when the order no longer prices the cart. */
export const CART_CHANGED_CODE = "CART_CHANGED";

interface RaisedFrom {
  order: CheckoutOrder;
  signature: string | null;
}

/**
 * Whether the basket in front of the checkout is no longer the one `order` was
 * raised from.
 *
 * The basket is recorded when the ORDER changes — a re-raise or a refresh
 * hands back a new object, so it is re-recorded and the warning clears — and
 * only once the host's cart has answered (`ready`): a loading cart reports the
 * EMPTY signature, and recording that would read every real cart as changed.
 * A host that passes no basket never sees the warning, which is the behaviour
 * before this existed.
 */
export function useBasketChanged(
  order: CheckoutOrder | null,
  basket: CheckoutBasketIdentity | undefined,
): boolean {
  const [raised, setRaised] = useState<RaisedFrom | null>(null);
  const ready = basket?.ready === true;
  const signature = basket?.signature ?? null;
  useEffect(() => {
    setRaised((prev) => {
      if (order === null) return null;
      if (prev?.order === order || !ready) return prev;
      return { order, signature };
    });
    // A cart change re-runs this and keeps `prev`: only a NEW order records, so
    // the raised basket never follows the cart it is compared with.
  }, [order, ready, signature]);
  if (order === null || raised === null || raised.order !== order || !ready) return false;
  return raised.signature !== signature;
}

/** The step's "bring this payment up to date", with what the buyer must see of it. */
export interface OrderRefresh {
  run: () => void;
  /** A refresh is on its way — the control waits rather than firing twice. */
  pending: boolean;
  /** The last refresh failed, in the host's words; null otherwise. */
  error: string | null;
}

/**
 * Re-price the order IN PLACE: ask the host for the order again and swap it in
 * without dropping the one on screen first.
 *
 * Unlike raising a payment (`./start-payment.ts`), nothing is cleared before
 * the answer: the card form keeps what the buyer typed, and the refusal that
 * sent us here stays on screen while the amount under it corrects itself. The
 * answer is routed exactly as a raise is (`route`, which is
 * `routeRaisedOrder`), so a re-priced order that is already PAID or must finish
 * on the provider's page goes where a raised one would.
 *
 * Three guards, each against something a review found:
 *
 * - one refresh at a time — a second tap while one is out does nothing;
 * - an answer for an order the screen has moved on from (the buyer switched
 *   method, or raised the payment again) is DROPPED rather than resurrected;
 * - a failure is KEPT here and shown by {@link CartChangedBoundary}, because the
 *   step's own create-error slot is hidden whenever an order is on screen.
 */
export function useOrderRefresh(input: {
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  saveProfile: boolean;
  createOrder: (request: CreateOrderRequest) => Promise<CreateOrderResult>;
  route: (order: CheckoutOrder) => void;
}): OrderRefresh {
  const { order, buyer, saveProfile, createOrder, route } = input;
  const offline = useCheckoutCopy().screens.transport.offline;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(order);
  const inFlight = useRef(false);
  useEffect(() => {
    current.current = order;
  }, [order]);
  // A failure is about the order it was raised for: once another is on screen
  // (a method switch, a fresh raise) it is no longer true, and must not stay up.
  const orderId = order?.orderId;
  const method = order?.method;
  useEffect(() => {
    setError(null);
  }, [orderId, method]);
  const run = useCallback(() => {
    if (!order || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    void createOrder({ method: order.method, buyer, saveProfile })
      .catch((): CreateOrderResult => ({ ok: false, error: { code: "NETWORK", message: offline, field: null } }))
      .then((result) => {
        inFlight.current = false;
        setPending(false);
        // The same order still on screen — by id and method, since a re-priced
        // order comes back as a new object for the same id.
        const now = current.current;
        if (!now || now.orderId !== order.orderId || now.method !== order.method) return;
        if (!result.ok) setError(result.error.message);
        else route(result.data);
      });
  }, [order, buyer, saveProfile, createOrder, route, offline]);
  return { run, pending, error };
}

/**
 * How this step brings a payment up to date with the cart (FUT-1139): a PIX
 * code is minted again — the amount is IN the code — and a card order is
 * re-priced in place so the form keeps what was typed.
 */
export function paymentRefresh(
  order: CheckoutOrder | null,
  onGenerate: (method: PaymentMethod) => void,
  onRefreshOrder: (() => void) | undefined,
): (() => void) | null {
  if (!order) return null;
  if (order.method === "CARD" && onRefreshOrder) return onRefreshOrder;
  return () => onGenerate(order.method);
}

const PaymentRefreshContext = createContext<(() => void) | null>(null);

/** Hands the payment panes the step's "bring this payment up to date". */
export function PaymentRefreshProvider({
  refresh,
  children,
}: {
  refresh: (() => void) | null;
  children: ReactNode;
}): JSX.Element {
  return <PaymentRefreshContext.Provider value={refresh}>{children}</PaymentRefreshContext.Provider>;
}

/**
 * The card pane's half: a charge the host refused with
 * {@link CART_CHANGED_CODE} re-reads the order, once per refusal.
 */
export function useRefreshOnCartChanged(errorCode: string | null): void {
  const refresh = useContext(PaymentRefreshContext);
  // Held in a ref: the step hands down a fresh closure on every render, and
  // keying the effect on it would re-fire the refresh after each re-price for
  // as long as the refusal stays on screen.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (errorCode === CART_CHANGED_CODE) latest.current?.();
  }, [errorCode]);
}

/**
 * The payment pane, with the step's warning above it when the cart moved, and
 * the refresh handed down to the card form. Nothing changes on screen while the
 * basket is the one the order was raised from.
 */
export function CartChangedBoundary({
  order,
  basket,
  creating,
  onGenerate,
  refresh,
  children,
}: {
  order: CheckoutOrder | null;
  /** Absent for a settlement: it pays a balance, not the cart, so its basket is no signal. */
  basket: CheckoutBasketIdentity | undefined;
  creating: boolean;
  onGenerate: (method: PaymentMethod) => void;
  refresh: OrderRefresh | undefined;
  children: ReactNode;
}): JSX.Element {
  const changed = useBasketChanged(order, basket) && !creating;
  const run = paymentRefresh(order, onGenerate, refresh?.run);
  const pending = refresh?.pending ?? false;
  const error = refresh?.error ?? null;
  // ONE tree shape whether or not the warning shows: wrapping the pane only
  // while it does would remount the card form the moment the refresh lands,
  // dropping what the buyer typed and the refusal that explains the new total.
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {(changed || error) && run ? <CartChangedNotice onRefresh={run} pending={pending} error={error} /> : null}
      <PaymentRefreshProvider refresh={run}>{children}</PaymentRefreshProvider>
    </Box>
  );
}

/** "Seu carrinho mudou" — what the step says, and the one thing to do about it. */
export function CartChangedNotice({
  onRefresh,
  pending = false,
  error = null,
}: {
  onRefresh: () => void;
  pending?: boolean;
  /** A refresh that failed, in the host's words: said, with the same control to try again. */
  error?: string | null;
}): JSX.Element {
  const { Alert, Button } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.cartChanged;
  return (
    <Box data-testid="checkout-cart-changed" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {error ? (
        <Alert variant="danger" title={copy.refreshFailed} description={error} showIcon data-testid="checkout-cart-changed-error" />
      ) : (
        <Alert variant="warning" title={copy.heading} description={copy.support} showIcon />
      )}
      <Box>
        <Button
          variant="solid"
          color="primary"
          size="md"
          onClick={onRefresh}
          loading={pending}
          disabled={pending}
          dataTestId="checkout-cart-changed-refresh"
        >
          {copy.refreshAction}
        </Button>
      </Box>
    </Box>
  );
}
