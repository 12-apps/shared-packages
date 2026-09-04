import { Box } from "@mui/material";
import type { JSX } from "react";

import { CheckCircleOutlineIcon, ErrorOutlineIcon, ScheduleIcon } from "./icons";
import type { CheckoutDecline } from "./decline";
import type { OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";
import type { PaymentStatusCopy, StatusOutcomeCopy } from "./view-copy";

/**
 * The BLOCKS the last screen of checkout is made of — its headline, its paid
 * receipt and its action row.
 *
 * Split out of `./payment-status.tsx` when the classified decline (FUT-1145)
 * and the buyer's own release (FUT-1146) took that file past its size gate.
 * The split is along the seam the screen already had: this module renders,
 * `payment-status.tsx` decides WHICH of these a status and a wait add up to.
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
export interface WaitState {
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

/**
 * What a REFUSED card says, as specifically as the server let us be (FUT-1145).
 *
 * Falls back to the generic refusal for a reason the host wrote no sentence for
 * — including one this bundle has never heard of, which is an ordinary state
 * when the server is a release ahead. The fallback is exactly the screen this
 * ticket started from, so the worst case is no worse than before.
 */
function failedOutcome(copy: PaymentStatusCopy, decline: CheckoutDecline | null): StatusOutcomeCopy {
  const reason = decline?.reason;
  // `?.` on the TABLE as well as the row: a host that has not written the block
  // at all lands on `failed`, which is a sentence it did write. The optional
  // chain is not a copy default — nothing is invented here — it is the
  // difference between one unworded refusal and a `TypeError` that unmounts a
  // live checkout. The type still REQUIRES the key, so a host that typechecks
  // is told; the ones that do not are the reason this is defensive at all.
  return (reason ? copy.declined?.[reason] : undefined) ?? copy.failed;
}

/** The headline block: icon, outcome, and one supporting line. */
export function OutcomeHero({
  copy,
  status,
  wait,
  decline,
}: {
  copy: PaymentStatusCopy;
  status: OrderStatus;
  wait: WaitState;
  decline: CheckoutDecline | null;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const face = status === "AWAITING_PAYMENT" ? awaitingFace(copy, wait) : null;
  const visual = face
    ? { icon: OUTCOME_VISUAL.AWAITING_PAYMENT.icon, tone: face.tone }
    : OUTCOME_VISUAL[status];
  const outcome = face
    ? face.outcome
    : status === "FAILED"
      ? failedOutcome(copy, decline)
      : copy[OUTCOME_COPY_KEY[status]];
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
export function PaidFacts({
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

/**
 * Whether "Tentar novamente" may be offered for a refusal (FUT-1145).
 *
 * `retriable === false` is the provider's OWN verdict that another attempt with
 * this instrument cannot succeed — attempts exhausted (10001), a cancelled
 * recurring mandate (20118), a malformed request. Offering a retry there is
 * offering a button that mints another failed order and shows the same screen
 * again; on a card the issuer is already counting, it is worse than useless.
 *
 * SILENCE MEANS YES. An undefined verdict is a provider that offered no
 * guidance, not a refusal to retry, and withholding the button on silence
 * would strand a buyer whose card is fine.
 */
function retryable(decline: CheckoutDecline | null): boolean {
  return decline?.retriable !== false;
}

/** The next-action row: retry / regenerate / check-again, always back-to-menu. */
export function StatusActions({
  copy,
  status,
  decline,
  onRetry,
  onRegenerate,
  onCheckAgain,
  onNotPaid,
  onBackToMenu,
}: {
  copy: PaymentStatusCopy;
  status: OrderStatus;
  decline: CheckoutDecline | null;
  onRetry?: () => void;
  onRegenerate?: () => void;
  /**
   * Offered only while the wait is unsettled AND not visibly working — the
   * caller decides that; here it is simply present or absent. A button under a
   * healthy spinner would invite a tap that changes nothing.
   */
  onCheckAgain?: () => void;
  /** The buyer's "I did not pay" (FUT-1146) — present only while it applies. */
  onNotPaid?: () => void;
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
      {onNotPaid ? (
        <Button
          variant="outline"
          color="neutral"
          size="lg"
          onClick={onNotPaid}
          dataTestId="payment-not-paid"
        >
          {copy.notPaidAction}
        </Button>
      ) : null}
      {status === "FAILED" && onRetry && retryable(decline) ? (
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
