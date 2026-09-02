import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { CheckCircleOutlineIcon, ErrorOutlineIcon, ScheduleIcon } from "./icons";
import type { OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";
import type { PaymentStatusCopy, StatusOutcomeCopy } from "./view-copy";

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

/**
 * The per-outcome VISUAL grammar — icon and semantic tone. The heading and
 * supporting line beside them come from {@link PaymentStatusCopy}: an icon is
 * the component's own vocabulary, a sentence never is. (The FAILED support
 * line's job — say "nothing was charged" plainly and first — and the
 * timed-out wait's "do not pay again" now live with the host's words, where
 * FUT-556's reasoning is documented on the copy port.)
 */
interface OutcomeVisual {
  icon: JSX.Element;
  /** Semantic theme token — never a raw colour. */
  tone: "success" | "danger" | "warning" | "neutral";
}

const OUTCOME_VISUAL: Record<OrderStatus, OutcomeVisual> = {
  PAID: { icon: <CheckCircleOutlineIcon fontSize="large" />, tone: "success" },
  AWAITING_PAYMENT: { icon: <ScheduleIcon fontSize="large" />, tone: "neutral" },
  FAILED: { icon: <ErrorOutlineIcon fontSize="large" />, tone: "danger" },
  EXPIRED: { icon: <ScheduleIcon fontSize="large" />, tone: "warning" },
};

const OUTCOME_COPY_KEY: Record<OrderStatus, keyof Pick<
  PaymentStatusCopy,
  "paid" | "awaiting" | "failed" | "expired"
>> = {
  PAID: "paid",
  AWAITING_PAYMENT: "awaiting",
  FAILED: "failed",
  EXPIRED: "expired",
};

const TONE_COLOR: Record<OutcomeVisual["tone"], string> = {
  success: "success.main",
  danger: "error.main",
  warning: "warning.main",
  neutral: "text.secondary",
};

/**
 * The buyer's quotable reference.
 *
 * The order id is a uuid — unreadable over a phone call and impossible to copy
 * by eye — so the screen shows its first block, uppercased. It is the real id's
 * own prefix rather than a second number, so support can still find the order
 * from what the buyer reads out.
 */
function orderReference(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** How the wait itself is going, when it has not resolved into an outcome. */
interface WaitState {
  /** The bounded wall-clock wait elapsed — nothing further is scheduled. */
  timedOut: boolean;
  /** The last poll failed, and the wait is still running (FUT-1144). */
  unreachable: boolean;
}

/**
 * Which of AWAITING's three faces this is.
 *
 * STOPPED beats STILL TRYING, and the order is the whole honesty of the screen.
 * A wait that ran its clock out while failing carries BOTH flags — the last
 * poll's error is still the last thing that happened — and saying "we keep
 * trying" over a wait nothing is scheduled for is precisely the lie this ticket
 * exists to remove. The elapsed state is also the one carrying "não pague de
 * novo", which is the sentence that matters most when we have stopped looking.
 *
 * Both keep AWAITING's neutral clock icon and take WARNING's tone: the order is
 * not resolved, and calm-but-alert is the visual for that.
 */
function awaitingFace(
  copy: PaymentStatusCopy,
  wait: WaitState,
): { outcome: StatusOutcomeCopy; tone: OutcomeVisual["tone"]; testId: string } | null {
  if (wait.timedOut) {
    return { outcome: copy.awaitingTimedOut, tone: "warning", testId: "payment-awaiting-timeout" };
  }
  if (wait.unreachable) {
    return { outcome: copy.awaitingUnreachable, tone: "warning", testId: "payment-awaiting-unreachable" };
  }
  return null;
}

/** The headline block: icon, outcome, and one supporting line. */
function OutcomeHero({
  copy,
  status,
  wait,
}: {
  copy: PaymentStatusCopy;
  status: OrderStatus;
  wait: WaitState;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const face = status === "AWAITING_PAYMENT" ? awaitingFace(copy, wait) : null;
  const visual = face
    ? { icon: OUTCOME_VISUAL.AWAITING_PAYMENT.icon, tone: face.tone }
    : OUTCOME_VISUAL[status];
  const outcome = face ? face.outcome : copy[OUTCOME_COPY_KEY[status]];
  return (
    <Box
      // `payment-paid` is load-bearing for the storefront journeys — it is how
      // they assert the buyer actually got there. Each unsettled wait gets its
      // OWN id rather than reusing `payment-awaiting_payment`: a test that
      // cannot tell "still asking" from "stopped asking" from "cannot reach the
      // payment" is a test that would pass against the spinner this replaced.
      data-testid={
        face ? face.testId : status === "PAID" ? "payment-paid" : `payment-${status.toLowerCase()}`
      }
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, textAlign: "center" }}
    >
      <Box sx={{ color: TONE_COLOR[visual.tone], display: "flex" }}>{visual.icon}</Box>
      <Text variant="heading" size="md" weight="bold" as="h2">
        {outcome.heading}
      </Text>
      <Text variant="body" size="sm" as="p" style={{ opacity: 0.75 }}>
        {outcome.support}
      </Text>
    </Box>
  );
}

/** One label/value row of the paid receipt block. */
function Fact({ label, value, testId }: { label: string; value: string; testId?: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
      <Text variant="body" size="sm" as="span" style={{ opacity: 0.75 }}>
        {label}
      </Text>
      <Text variant="body" size="sm" weight="bold" as="span" data-testid={testId}>
        {value}
      </Text>
    </Box>
  );
}

/**
 * What a paid buyer will want later: how much left their account, which order
 * it was, and where the receipt went. Rendered only for PAID — on any other
 * outcome these facts are either untrue or not yet knowable.
 */
function PaidFacts({
  copy,
  totalLabel,
  orderId,
  buyerEmail,
}: {
  copy: PaymentStatusCopy;
  totalLabel: string;
  orderId?: string;
  buyerEmail?: string;
}): JSX.Element {
  return (
    <Box
      data-testid="payment-receipt"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 2,
        borderRadius: 2,
        bgcolor: "action.hover",
      }}
    >
      <Fact label={copy.amountLabel} value={totalLabel} testId="payment-amount" />
      {orderId ? (
        <Fact label={copy.referenceLabel} value={`#${orderReference(orderId)}`} testId="payment-reference" />
      ) : null}
      {buyerEmail ? <Fact label={copy.receiptEmailLabel} value={buyerEmail} /> : null}
    </Box>
  );
}

/** The next-action row: retry / regenerate / check-again, always back-to-menu. */
function StatusActions({
  copy,
  status,
  onRetry,
  onRegenerate,
  onCheckAgain,
  onBackToMenu,
}: {
  copy: PaymentStatusCopy;
  status: OrderStatus;
  onRetry?: () => void;
  onRegenerate?: () => void;
  /**
   * Offered only while the wait is unsettled AND not visibly working — the
   * caller decides that; here it is simply present or absent. A button under a
   * healthy spinner would invite a tap that changes nothing.
   */
  onCheckAgain?: () => void;
  onBackToMenu: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {onCheckAgain ? (
        <Button
          variant="solid"
          color="primary"
          size="lg"
          onClick={onCheckAgain}
          dataTestId="payment-check-again"
        >
          {copy.checkAgainAction}
        </Button>
      ) : null}
      {status === "FAILED" && onRetry ? (
        <Button variant="solid" color="primary" size="lg" onClick={onRetry} dataTestId="payment-retry">
          {copy.retryAction}
        </Button>
      ) : null}
      {status === "EXPIRED" && onRegenerate ? (
        <Button variant="solid" color="primary" size="lg" onClick={onRegenerate} dataTestId="payment-regenerate">
          {copy.regenerateAction}
        </Button>
      ) : null}
      <Button
        // Full width and last, so the thumb lands on the same place in every
        // outcome instead of hunting a button that moves with the state.
        variant={status === "PAID" ? "solid" : "outline"}
        color={status === "PAID" ? "primary" : "neutral"}
        size="lg"
        onClick={onBackToMenu}
        dataTestId="payment-back-to-menu"
      >
        {copy.backAction}
      </Button>
    </Box>
  );
}

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

export function PaymentStatus({
  copy,
  status,
  totalLabel,
  orderId,
  buyerEmail,
  onRetry,
  onRegenerate,
  onBackToMenu,
  paidExtra,
  awaitingTimedOut = false,
  awaitingError = null,
  onCheckAgain,
}: PaymentStatusProps): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  const effective: OrderStatus = status ?? "AWAITING_PAYMENT";
  const wait: WaitState = { timedOut: awaitingTimedOut, unreachable: awaitingError !== null };
  const stalled = isStalled(effective, wait);
  const paid = effective === "PAID";
  const spinning = effective === "AWAITING_PAYMENT" && !stalled;

  return (
    <Box
      data-testid="payment-status"
      data-status={effective}
      data-timed-out={awaitingTimedOut ? "true" : undefined}
      sx={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", py: 2 }}
    >
      <OutcomeHero copy={copy} status={effective} wait={wait} />

      {paid ? (
        <PaidFacts copy={copy} totalLabel={totalLabel} orderId={orderId} buyerEmail={buyerEmail} />
      ) : null}

      {paid ? paidExtra : null}

      {spinning ? (
        <LoadingState variant="spinner" size="md" message="" dataTestId="payment-pending" />
      ) : null}

      <StatusActions
        copy={copy}
        status={effective}
        onRetry={onRetry}
        onRegenerate={onRegenerate}
        onCheckAgain={offeredCheckAgain(stalled, onCheckAgain)}
        onBackToMenu={onBackToMenu}
      />
    </Box>
  );
}
