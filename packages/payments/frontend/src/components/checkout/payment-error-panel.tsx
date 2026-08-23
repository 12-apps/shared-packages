import { Box } from "@mui/material";
import { useState, type JSX } from "react";

import { useCheckoutCopy } from "./copy-context";
import { UNRESOLVED_CODE } from "./failure-codes";
import { useCheckoutComponents } from "./ui";

/**
 * Order-creation failure shown inline on Pagamento — the buyer never leaves the
 * step. Split out of `checkout-steps.tsx` when it grew a second presentation.
 *
 * Three shapes, and which one renders is decided by the failure's CODE, never
 * by its prose:
 *
 *  - the buyer e-mail was rejected (the owner testing with the store's own
 *    address) — offer a different e-mail to pay with;
 *  - the charge is UNRESOLVED — a warning, and NO retry. Some provider may be
 *    holding the buyer's money, so "Tentar novamente" mints a second order at
 *    a new reference, outside the walk's re-probe of the old one: precisely
 *    the double payment the message forbids, offered as the panel's most
 *    prominent affordance;
 *  - anything else — the ordinary danger Alert with a retry.
 */
export function PaymentErrorPanel({
  message,
  emailFlagged,
  code,
  onUseEmail,
  onRetry,
}: {
  message: string;
  emailFlagged: boolean;
  /** The refusal's machine code, when the server sent one. */
  code?: string | null;
  onUseEmail: (email: string) => void;
  onRetry: () => void;
}): JSX.Element {
  const { Alert } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.error;
  const unresolved = code === UNRESOLVED_CODE;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Alert
        variant={unresolved ? "warning" : "danger"}
        title={unresolved ? copy.confirming : copy.cannotContinue}
        description={message}
        showIcon
        data-testid={unresolved ? "checkout-unresolved" : "checkout-error"}
      />
      {unresolved ? null : <RetryAffordance {...{ emailFlagged, onUseEmail, onRetry }} />}
    </Box>
  );
}

/** What the buyer can do about a failure that IS safe to retry. */
function RetryAffordance({
  emailFlagged,
  onUseEmail,
  onRetry,
}: {
  emailFlagged: boolean;
  onUseEmail: (email: string) => void;
  onRetry: () => void;
}): JSX.Element {
  const { Button, Input } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.error;
  const [altEmail, setAltEmail] = useState("");

  if (!emailFlagged) {
    return (
      <Box>
        <Button variant="solid" color="primary" size="md" onClick={onRetry} dataTestId="checkout-retry-payment">
          {copy.retryAction}
        </Button>
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Input
        label={copy.emailLabel}
        type="email"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="email"
        placeholder={copy.emailMustDifferHint}
        value={altEmail}
        onChange={(event) => setAltEmail(event.target.value)}
        data-testid="checkout-alt-email"
      />
      <Box>
        <Button variant="solid" color="primary" size="md" disabled={!altEmail.trim()} onClick={() => onUseEmail(altEmail.trim())} dataTestId="checkout-use-alt-email">
          {copy.useEmailAction}
        </Button>
      </Box>
    </Box>
  );
}
