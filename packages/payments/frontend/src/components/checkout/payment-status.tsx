import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import type { PaymentShortfall, PaymentStockGone } from "@12-apps/payments-backend";

import type { CheckoutDecline } from "./decline";
import {
  OutcomeHero,
  PaidFacts,
  StatusActions,
  type BackActionEmphasis,
  type WaitState,
} from "./payment-status-parts";
import { ShortOutcome, StockGoneNotice } from "./payment-status-short";
import type { ShortPaymentCopy } from "./short-copy";
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
   * Host content that REPLACES the PAID icon at the top of the screen — the
   * storefront's mascot celebrating a buyer's first order or birthday. Absent,
   * the screen is exactly what it was. Never shown on any other status.
   *
   * Pass it only when there is something to show (`cond ? <Mascot /> : undefined`):
   * an element that renders nothing still replaces the icon. It is decorative —
   * the heading beside it says what happened — so mark it `aria-hidden`.
   */
  paidHero?: ReactNode;
  /**
   * Host content rendered AFTER the action row, and ONLY on PAID.
   *
   * The other half of {@link paidExtra}, and the difference between them is the
   * actions. What a buyer has to DO next belongs beside the way out, in one
   * block: a panel dropped between two controls splits the only decision on the
   * screen in half. What is merely OFFERED — an install invite, an ask to turn
   * on alerts — belongs after that block, because it is about everything that
   * happens once this screen is closed and must not come between a shopper and
   * the order they just paid for.
   */
  paidFooter?: ReactNode;
  /**
   * Whether back-to-menu leads a PAID screen (default) or stands down for an
   * action the host renders in {@link paidExtra}. See {@link BackActionEmphasis}.
   */
  backActionEmphasis?: BackActionEmphasis;
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
  /**
   * The payment was a Pix only the STORE confirms (FUT-3232): a FAILED or
   * EXPIRED screen then says the store did not find it, never that nothing
   * was charged.
   */
  manual?: boolean;
  /**
   * A capture arrived SHORT of the total (FUT-612) — the server's fact, from
   * `getStatusDetail`, never inferred here. With `copy.short`, a settled
   * screen shows what is missing and the two acts below instead of the
   * refusal; without either, the screen is exactly what it was.
   */
  shortfall?: PaymentShortfall | null;
  /** The whole amount arrived and an item ran out (FUT-612): its own notice, no action. */
  stockGone?: PaymentStockGone | null;
  /** Pay only what is missing. Not offered when absent. */
  onPayDifference?: () => void;
  /** Cancel and have the capture returned. Not offered when absent. */
  onRequestRefund?: () => void;
  /** One of those two acts is in flight. */
  shortBusy?: "pay" | "refund" | null;
  /** Why the last refund was not taken ("" when no sentence came); the acts stay offered for a retry. */
  shortError?: string | null;
}

/**
 * Which money fact this screen shows, if any (FUT-612). Only on a SETTLED
 * screen — a wait has no answer yet — and only with the host's words for it.
 * A confirmed order keeps its paid receipt, unless the confirmation IS the
 * store settling the short, which says so.
 */
type MoneyFact =
  | { kind: "stock"; copy: ShortPaymentCopy; stockGone: PaymentStockGone }
  | { kind: "short"; copy: ShortPaymentCopy; shortfall: PaymentShortfall };

function moneyFact(props: PaymentStatusProps): MoneyFact | null {
  const status = props.status ?? "AWAITING_PAYMENT";
  const copy = props.copy.short;
  if (!copy || status === "AWAITING_PAYMENT") return null;
  if (props.stockGone && status !== "PAID") return { kind: "stock", copy, stockGone: props.stockGone };
  const shortfall = props.shortfall;
  if (!shortfall) return null;
  return status !== "PAID" || shortfall.resolution === "SETTLED" ? { kind: "short", copy, shortfall } : null;
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
  const fact = moneyFact(props);
  return fact ? <MoneyFactStatus props={props} fact={fact} /> : <OutcomeStatus {...props} />;
}

/** A settled screen whose money ARRIVED and is not yet an order (FUT-612). */
function MoneyFactStatus({ props, fact }: { props: PaymentStatusProps; fact: MoneyFact }): JSX.Element {
  return (
    <Box
      data-testid="payment-status"
      data-status={props.status ?? undefined}
      data-money-fact={fact.kind}
      sx={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", py: 2 }}
    >
      {fact.kind === "stock" ? (
        <StockGoneNotice copy={fact.copy} stockGone={fact.stockGone} />
      ) : (
        <ShortOutcome
          copy={fact.copy}
          shortfall={fact.shortfall}
          onPayDifference={props.onPayDifference}
          onRequestRefund={props.onRequestRefund}
          busy={props.shortBusy ?? null}
          error={props.shortError ?? null}
          backAction={props.copy.backAction}
          onBackToMenu={props.onBackToMenu}
        />
      )}
    </Box>
  );
}

/** Every outcome but a money fact — the screen as it always was. */
function OutcomeStatus(props: PaymentStatusProps): JSX.Element {
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
      <OutcomeHero
        copy={copy}
        status={view.effective}
        wait={view.wait}
        decline={view.decline}
        hero={props.paidHero}
        manual={props.manual === true}
      />

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
        backActionEmphasis={props.backActionEmphasis}
        manual={props.manual === true}
      />

      {view.paid ? props.paidFooter : null}
    </Box>
  );
}
