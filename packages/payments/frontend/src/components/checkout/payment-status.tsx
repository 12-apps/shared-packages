import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { CheckCircleOutlineIcon, ErrorOutlineIcon, ScheduleIcon } from "./icons";
import type { OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";

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

/** Everything the hero block needs, per outcome. */
interface Outcome {
  heading: string;
  support: string;
  icon: JSX.Element;
  /** Semantic theme token — never a raw colour. */
  tone: "success" | "danger" | "warning" | "neutral";
}

const OUTCOME: Record<OrderStatus, Outcome> = {
  PAID: {
    heading: "Pedido confirmado",
    support: "Recebemos seu pagamento e já registramos o pedido.",
    icon: <CheckCircleOutlineIcon fontSize="large" />,
    tone: "success",
  },
  AWAITING_PAYMENT: {
    heading: "Confirmando seu pagamento",
    support: "Isso costuma levar alguns segundos. Pode deixar esta tela aberta.",
    icon: <ScheduleIcon fontSize="large" />,
    tone: "neutral",
  },
  FAILED: {
    heading: "Pagamento não concluído",
    // Said plainly and first: the fear on this screen is having been charged
    // for an order that failed.
    support: "Nenhum valor foi cobrado. Você pode tentar novamente.",
    icon: <ErrorOutlineIcon fontSize="large" />,
    tone: "danger",
  },
  EXPIRED: {
    heading: "O código expirou",
    support: "Nenhum valor foi cobrado. Gere um novo código para continuar.",
    icon: <ScheduleIcon fontSize="large" />,
    tone: "warning",
  },
};

/**
 * What the screen says once it has stopped asking (FUT-556).
 *
 * NOT an `OrderStatus`: the order really is still AWAITING_PAYMENT and may yet
 * settle — the scheduled reconciliation keeps asking the provider long after
 * this tab is gone. What ran out is the WAIT, not the order, and saying
 * otherwise would be the more expensive lie: a buyer told "não concluído" who
 * has in fact paid will either pay twice or call the store.
 *
 * So it leads with what is true and unglamorous — we have not heard yet — and
 * spends its remaining words on the one instruction that matters, which is not
 * to pay again.
 */
const AWAITING_TIMED_OUT: Outcome = {
  heading: "Ainda não recebemos a confirmação",
  support:
    "Se você já pagou, o pedido é confirmado assim que a operadora avisar — " +
    "não pague de novo. Você pode fechar esta tela.",
  icon: <ScheduleIcon fontSize="large" />,
  tone: "warning",
};

const TONE_COLOR: Record<Outcome["tone"], string> = {
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

/** The headline block: icon, outcome, and one supporting line. */
function OutcomeHero({
  status,
  timedOut = false,
}: {
  status: OrderStatus;
  timedOut?: boolean;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const outcome = timedOut && status === "AWAITING_PAYMENT" ? AWAITING_TIMED_OUT : OUTCOME[status];
  return (
    <Box
      // `payment-paid` is load-bearing for the storefront journeys — it is how
      // they assert the buyer actually got there. The timed-out wait gets its
      // OWN id rather than reusing `payment-awaiting_payment`: a test that
      // cannot tell "still asking" from "stopped asking" is a test that would
      // pass against the unbounded spinner this replaced.
      data-testid={
        timedOut && status === "AWAITING_PAYMENT"
          ? "payment-awaiting-timeout"
          : status === "PAID"
            ? "payment-paid"
            : `payment-${status.toLowerCase()}`
      }
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, textAlign: "center" }}
    >
      <Box sx={{ color: TONE_COLOR[outcome.tone], display: "flex" }}>{outcome.icon}</Box>
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
  totalLabel,
  orderId,
  buyerEmail,
}: {
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
      <Fact label="Valor pago" value={totalLabel} testId="payment-amount" />
      {orderId ? (
        <Fact label="Pedido" value={`#${orderReference(orderId)}`} testId="payment-reference" />
      ) : null}
      {buyerEmail ? <Fact label="Comprovante enviado para" value={buyerEmail} /> : null}
    </Box>
  );
}

/** The next-action row: retry / regenerate for failures, always back-to-menu. */
function StatusActions({
  status,
  onRetry,
  onRegenerate,
  onBackToMenu,
}: {
  status: OrderStatus;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onBackToMenu: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {status === "FAILED" && onRetry ? (
        <Button variant="solid" color="primary" size="lg" onClick={onRetry} dataTestId="payment-retry">
          Tentar novamente
        </Button>
      ) : null}
      {status === "EXPIRED" && onRegenerate ? (
        <Button variant="solid" color="primary" size="lg" onClick={onRegenerate} dataTestId="payment-regenerate">
          Gerar novo código
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
        Voltar ao cardápio
      </Button>
    </Box>
  );
}

export function PaymentStatus({
  status,
  totalLabel,
  orderId,
  buyerEmail,
  onRetry,
  onRegenerate,
  onBackToMenu,
  paidExtra,
  awaitingTimedOut = false,
}: {
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
   * The wait has been given up on — see {@link AWAITING_TIMED_OUT}. Only
   * meaningful while AWAITING_PAYMENT; every other status has already resolved,
   * so a stale flag cannot change what a settled screen says.
   */
  awaitingTimedOut?: boolean;
}): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  const effective: OrderStatus = status ?? "AWAITING_PAYMENT";

  return (
    <Box
      data-testid="payment-status"
      data-status={effective}
      data-timed-out={awaitingTimedOut ? "true" : undefined}
      sx={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", py: 2 }}
    >
      <OutcomeHero status={effective} timedOut={awaitingTimedOut} />

      {effective === "PAID" ? (
        <PaidFacts totalLabel={totalLabel} orderId={orderId} buyerEmail={buyerEmail} />
      ) : null}

      {effective === "PAID" ? paidExtra : null}

      {effective === "AWAITING_PAYMENT" && !awaitingTimedOut ? (
        <LoadingState variant="spinner" size="md" message="" dataTestId="payment-pending" />
      ) : null}

      <StatusActions
        status={effective}
        onRetry={onRetry}
        onRegenerate={onRegenerate}
        onBackToMenu={onBackToMenu}
      />
    </Box>
  );
}
