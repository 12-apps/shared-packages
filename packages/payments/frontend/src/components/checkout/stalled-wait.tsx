import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutCopy } from "./copy-context";
import { useCheckoutComponents } from "./ui";

/**
 * A wait that has stopped LOOKING like progress, said as a warning with the
 * buyer's own "ask now" underneath (FUT-1144).
 *
 * Two situations reach it and they are deliberately the same shape: the poll
 * cannot reach us, or the wall-clock wait has run out. In both, the confirmation
 * spinner would be telling the buyer something is happening when nothing is —
 * and by this point in the card and wallet panes every pay control is already
 * gone, so without this button the screen has no control at all while it reports
 * a problem. Pressing it restarts the wait, which is what makes it worth
 * offering after a timeout and not only during a blip.
 *
 * A WARNING rather than a danger, in both. Neither says the payment failed:
 * the charge is recoverable by webhook, reconciliation or backfill, and a red
 * panel over a recoverable charge is what pushes a buyer into paying twice.
 *
 * One component for the card and the wallet because it is one decision. The
 * panes' own confirmation states were near-identical before this and drifted
 * apart in exactly the way that ends with a product telling a buyer two
 * different things about one situation depending on which button they pressed.
 */
export function StalledWait({
  title,
  description,
  onCheckAgain,
  testId,
  actionTestId,
}: {
  title: string;
  description: string;
  onCheckAgain: () => void;
  /** The alert's id — each pane names its own situation for its own suites. */
  testId: string;
  actionTestId: string;
}): JSX.Element {
  const { Alert, Button } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.settling;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Alert variant="warning" title={title} description={description} showIcon data-testid={testId} />
      <Button
        variant="outline"
        color="neutral"
        size="md"
        onClick={onCheckAgain}
        dataTestId={actionTestId}
      >
        {copy.checkAgainAction}
      </Button>
    </Box>
  );
}
