import { Box } from "@mui/material";
import { useCallback, useMemo, useState, type JSX, type ReactNode } from "react";

import type { PixStage } from "./pix-stage";
import type { PaymentMethod } from "./types";

/**
 * The width of the Dados and confirmation steps, and of every non-PIX pane:
 * the content of the 720px column the checkout always had once its host's
 * 24px gutters are taken (672). A host that widens the checkout for the PIX
 * pane (FUT-3367) leaves everything else exactly as wide as before.
 */
export const STEP_COLUMN_MAX = 672;

/**
 * The payment step's form column. The host may give this step more room than
 * the others (the 2026-10-06 Pix redesign lets the PIX pane put its QR and code
 * side by side), and only that pane uses it: the card form, wallets, hand-off,
 * the payer line and the raising and error panels keep the 672px they
 * always had. `full` lets the PIX pane through.
 */
export function StepColumn({ full = false, children }: { full?: boolean; children: ReactNode }): JSX.Element {
  // `:empty` keeps a self-hiding child (the payer line, the raising state)
  // from leaving a gap in the step's flex column.
  return <Box sx={{ width: "100%", mx: "auto", maxWidth: full ? "none" : STEP_COLUMN_MAX, "&:empty": { display: "none" } }}>{children}</Box>;
}

/**
 * The payment step's half of the PIX pane's after-copy face (the 2026-10-06
 * Pix redesign): the flag that hides the method picker, and the way to the
 * card that replaces it — offered only when the store actually takes a card,
 * since with the picker hidden it is the buyer's only route there.
 */
export function usePaymentPixStage(
  choice: { offered: PaymentMethod[] | null; cardUnavailable: boolean },
  onMethodChange: (method: PaymentMethod) => void,
): PixStage {
  const [afterCopy, setAfterCopy] = useState(false);
  const cardOffered = (choice.offered === null || choice.offered.includes("CARD")) && !choice.cardUnavailable;
  const preferCard = useCallback(() => {
    setAfterCopy(false);
    onMethodChange("CARD");
  }, [onMethodChange]);
  return useMemo(
    () => ({ afterCopy, setAfterCopy, preferCard: cardOffered ? preferCard : undefined }),
    [afterCopy, cardOffered, preferCard],
  );
}

/**
 * Step 2 "Pagamento" — pick PIX or card and pay on the SAME page. Selecting a
 * method auto-raises its order and reveals its UI (PIX QR / card form) with no
 * intermediate tap; switching method clears the previous order (controller).
 *
 * ## Unless the choice is not ours to ask
 *
 * A store that finishes checkout on the provider's own page gets NO picker
 * here (`methodChosenAtProvider`). Its screen renders a single "Seguir para o
 * pagamento" instead, and pressing it selects the store's hand-off method —
 * which is the same event a tile press is, so the auto-raise, the error panel
 * and the retry below all keep working unchanged. Preselection is suppressed
 * for the same flow, and deliberately: it exists to spare a buyer a tap that
 * buys them nothing, but here the tap is the buyer's consent to LEAVE, and
 * taking it for them would redirect a checkout the moment it rendered.
 */
