import type { JSX } from "react";

import type { CheckoutDecline } from "./decline";
import type { OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";
import type { PaymentStatusCopy } from "./view-copy";

/**
 * The confirmation screen's "pay again" action — retry or regenerate — split
 * out of `./payment-status-parts.tsx` when the Pix the store confirms
 * (FUT-3232) gave it a second look and took that file past its size gate.
 */

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

/**
 * How "Tentar novamente" / "Gerar novo código" look. Under a Pix the store
 * confirms they step back to outline: the sentence above them asks a buyer who
 * may already have paid to talk to the store first, and a filled button would
 * say the opposite.
 */
function againLook(byStore: boolean): { variant: "solid" | "outline"; color: "primary" | "neutral" } {
  return byStore ? { variant: "outline", color: "neutral" } : { variant: "solid", color: "primary" };
}

/** "Tentar novamente" on a retryable FAILED, "Gerar novo código" on EXPIRED, else nothing. */
export function PayAgain({
  copy,
  status,
  decline,
  onRetry,
  onRegenerate,
  byStore,
}: {
  copy: PaymentStatusCopy;
  status: OrderStatus;
  decline: CheckoutDecline | null;
  onRetry?: () => void;
  onRegenerate?: () => void;
  byStore: boolean;
}): JSX.Element | null {
  const { Button } = useCheckoutComponents();
  const again = againLook(byStore);
  if (status === "FAILED" && onRetry && retryable(decline)) {
    return (
      <Button variant={again.variant} color={again.color} size="lg" onClick={onRetry} dataTestId="payment-retry">
        {copy.retryAction}
      </Button>
    );
  }
  if (status === "EXPIRED" && onRegenerate) {
    return (
      <Button
        variant={again.variant}
        color={again.color}
        size="lg"
        onClick={onRegenerate}
        dataTestId="payment-regenerate"
      >
        {copy.regenerateAction}
      </Button>
    );
  }
  return null;
}

