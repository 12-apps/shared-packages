import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import type { CheckoutDecline } from "./decline";
import { OutcomeHero, PaidFacts, StatusActions, type WaitState } from "./payment-status-parts";
import type { OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";
import type { PaymentStatusCopy } from "./view-copy";

/**
 * The last screen of checkout.
 *
 * It used to be a status page: the heading said "Pagamento" — the step the
 * buyer had just finished — with a small success strip underneath and a chip
 * repeating what the strip already said. Three things were wrong with that for
 * somebody who has just handed over money:
 *
 *  - it never said the thing they came for. "Pedido confirmado" is the outcome;
 *    "Pagamento" is a step, and reading it back after paying leaves the buyer
 *    wondering whether anything happened.
 *  - the confirmation carried no facts they could use later — no reference to
 *    quote, no note of where the receipt went.
 *  - success and failure looked the same shape, so the screen's most important
 *    distinction was carried only by a small coloured strip.
 *
 * Each state now leads with its own outcome, and the paid one carries the
 * amount, the order reference and the receipt's destination.
 *
 * The FLOW is untouched: same steps, same actions, same polling. Only what the
 * screen says and how it is arranged has changed.
 */

/** What the last screen of checkout is handed. */
interface PaymentStatusProps {
  /** Every sentence and label this screen renders — the HOST's words. */
  copy: PaymentStatusCopy;
  status: OrderStatus | null;
  totalLabel: string;
  /** The created order, when there is one — absent before the charge is raised. */
  orderId?: string;
  /** Where the receipt was sent, when known. */
  buyerEmail?: string;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onBackToMenu: () => void;
  /**
   * Host content rendered under the paid receipt, and ONLY on PAID — the
   * storefront puts its PWA install invite here (FUT-640): a customer who has
   * just completed an order knows exactly what they would be installing, which
   * is the difference between an offer and an interruption.
   */
  paidExtra?: ReactNode;
  /**
   * The wait has been given up on. Only meaningful while AWAITING_PAYMENT;
   * every other status has already resolved, so a stale flag cannot change what
   * a settled screen says.
   */
  awaitingTimedOut?: boolean;
  /**
   * The wait's last poll failed (FUT-1144). Same scope rule as
   * {@link awaitingTimedOut}, and it YIELDS to it: a wait that failed its way to
   * the wall clock has both, and the honest thing to say then is that we have
   * stopped asking.
   */
  awaitingError?: string | null;
  /**
   * Ask now. Rendered ONLY while the automatic wait is not visibly working —
   * unreachable, or elapsed — so the buyer always has something to press when
   * the spinner cannot honestly stand for progress, and nothing extra to think
   * about when it can.
   */
  onCheckAgain?: () => void;
  /**
   * The buyer says they did not pay (FUT-1146). Present only while the wait is
   * genuinely unsettled and the caller has something to release; rendered on
   * AWAITING and nowhere else, because every other status has an answer already
   * and this action is the one that manufactures one.
   */
  onNotPaid?: () => void;
  /** A release is in flight — the action stands down rather than repeating. */
  releasing?: boolean;
  /**
   * WHY the charge was refused (FUT-1145). Read only on FAILED: it chooses the
   * sentence, and it decides whether a retry is offered at all.
   */
  decline?: CheckoutDecline | null;
}

/**
 * The wait has stopped LOOKING like progress: it cannot reach us, or it has run
 * its clock out. Either way the spinner would be a lie and the buyer is owed
 * something to press. Scoped to AWAITING because every other status has already
 * resolved, so a stale flag cannot change what a settled screen says.
 */
function isStalled(status: OrderStatus, wait: WaitState): boolean {
  if (status !== "AWAITING_PAYMENT") return false;
  return wait.timedOut || wait.unreachable;
}

/**
 * The check-again action, but only where it can honestly be offered — a button
 * under a healthy spinner invites a tap that changes nothing.
 */
function offeredCheckAgain(
  stalled: boolean,
  onCheckAgain: (() => void) | undefined,
): (() => void) | undefined {
  return stalled ? onCheckAgain : undefined;
}

/** What the props ADD UP TO — every branch this screen makes, made once. */
interface StatusView {
  effective: OrderStatus;
  wait: WaitState;
  paid: boolean;
  spinning: boolean;
  decline: CheckoutDecline | null;
  checkAgain: (() => void) | undefined;
  notPaid: (() => void) | undefined;
}

/**
 * Resolve the props into that view.
 *
 * A pure function rather than a block inside the component, because the
 * decisions and the markup are two different things to read — and because the
 * component was over the complexity gate with all of them inlined.
 */
function statusView(props: PaymentStatusProps): StatusView {
  const effective: OrderStatus = props.status ?? "AWAITING_PAYMENT";
  const wait: WaitState = {
    timedOut: props.awaitingTimedOut === true,
    unreachable: (props.awaitingError ?? null) !== null,
  };
  const stalled = isStalled(effective, wait);
  const awaiting = effective === "AWAITING_PAYMENT";
  return {
    effective,
    wait,
    paid: effective === "PAID",
    spinning: awaiting && !stalled,
    decline: props.decline ?? null,
    checkAgain: offeredCheckAgain(stalled, props.onCheckAgain),
    // Scoped to the unsettled wait, and stood down while its own request is
    // out. A settled screen has its answer; a second tap would only ask again.
    notPaid: awaiting && props.releasing !== true ? props.onNotPaid : undefined,
  };
}

export function PaymentStatus(props: PaymentStatusProps): JSX.Element {
  const { copy, totalLabel, orderId, buyerEmail, onRetry, onRegenerate, onBackToMenu } = props;
  const { LoadingState } = useCheckoutComponents();
  const view = statusView(props);

  return (
    <Box
      data-testid="payment-status"
      data-status={view.effective}
      data-timed-out={view.wait.timedOut ? "true" : undefined}
      sx={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", py: 2 }}
    >
      <OutcomeHero copy={copy} status={view.effective} wait={view.wait} decline={view.decline} />

      {view.paid ? (
        <PaidFacts copy={copy} totalLabel={totalLabel} orderId={orderId} buyerEmail={buyerEmail} />
      ) : null}

      {view.paid ? props.paidExtra : null}

      {view.spinning ? (
        <LoadingState variant="spinner" size="md" message="" dataTestId="payment-pending" />
      ) : null}

      <StatusActions
        copy={copy}
        status={view.effective}
        decline={view.decline}
        onRetry={onRetry}
        onRegenerate={onRegenerate}
        onCheckAgain={view.checkAgain}
        onNotPaid={view.notPaid}
        onBackToMenu={onBackToMenu}
      />
    </Box>
  );
}
