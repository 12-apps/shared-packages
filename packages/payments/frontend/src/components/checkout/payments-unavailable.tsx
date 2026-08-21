/**
 * What a shopper sees when the store cannot take money online.
 *
 * A store with no active payment provider used to render the full payment step
 * — PIX and Cartão side by side — and only fail at order creation, with a
 * "tente novamente em instantes" that no amount of retrying could fix. The
 * store is not momentarily busy; it simply does not charge online.
 *
 * The remedy depends on how the store operates, so the two cases are answered
 * differently rather than with one vague apology:
 *
 *   waiter reachable — someone is there to take payment: offer the waiter.
 *   not reachable    — nobody is; say plainly that this store does not charge
 *                      online, so the shopper stops waiting for a payment screen.
 *
 * "Reachable" is a property of THIS shopper, not of the store: a mesas
 * restaurant also serves the balcão, and a shopper with no mesa has no comanda
 * for a waiter to close. Offering them the waiter sent them to a comanda screen
 * whose own mesa gate bounced them straight back to the menu — a dead end
 * dressed up as the remedy. So the caller decides, from the shopper's mesa.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "./ui";
import type { PaymentsUnavailableCopy } from "./view-copy";

interface PaymentsUnavailableProps {
  /**
   * Every sentence this screen can say — the HOST's words (see
   * `./view-copy`). Until 6.0.0 the two remedies and the button were compiled
   * in, in one application's Portuguese, and a host that dutifully passed the
   * flows copy port still got them.
   */
  copy: PaymentsUnavailableCopy;
  /**
   * Whether THIS shopper can settle with a waiter — mesas on AND a mesa of
   * their own. Decides which remedy is offered.
   */
  waiterAvailable: boolean;
  /** Called when the shopper asks for a waiter. Omitted ⇒ no button. */
  onCallWaiter?: () => void;
  /** True while the waiter request is in flight. */
  calling?: boolean;
}

export function PaymentsUnavailable({
  copy,
  waiterAvailable,
  onCallWaiter,
  calling = false,
}: PaymentsUnavailableProps): JSX.Element {
  const { Alert, Button } = useCheckoutComponents();
  if (!waiterAvailable) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="checkout-payments-disabled">
        <Alert
          variant="info"
          title={copy.title}
          description={copy.body}
          showIcon
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="checkout-call-waiter">
      <Alert
        variant="info"
        title={copy.remedyTitle}
        description={copy.remedyBody}
        showIcon
      />
      {onCallWaiter ? (
        <Button
          variant="solid"
          size="lg"
          disabled={calling}
          onClick={onCallWaiter}
          dataTestId="checkout-call-waiter-button"
        >
          {calling ? copy.callingAction : copy.callAction}
        </Button>
      ) : null}
    </Box>
  );
}
