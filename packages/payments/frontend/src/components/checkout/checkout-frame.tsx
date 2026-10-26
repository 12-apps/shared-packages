import { Box } from "@mui/material";
import { useMemo, type JSX, type ReactNode } from "react";

import { CheckoutLayoutProvider, STEP_COLUMN_MAX, useWideLayout } from "./payment-step-layout";

/**
 * The flow's frame: measured once at the host's full width (FUT-3525), so
 * every step agrees on whether this is the computer's layout or the phone's.
 * The host draws its own stepper around it (FUT-3999); the flow draws none.
 */

/**
 * Measured at the HOST's full width: one frame for the whole flow. Pagamento
 * alone takes that width (its summary column); every other step keeps the
 * 672px column it always had.
 */
export function CheckoutFrame({ payment, children }: { payment: boolean; children: ReactNode }): JSX.Element {
  const [wide, frame] = useWideLayout();
  const layout = useMemo(() => ({ wide }), [wide]);
  return (
    <Box ref={frame} sx={{ width: "100%" }}>
      <CheckoutLayoutProvider value={layout}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: { xs: 2, sm: 3 }, width: "100%", mx: "auto", maxWidth: payment ? "none" : STEP_COLUMN_MAX }}>
          {children}
        </Box>
      </CheckoutLayoutProvider>
    </Box>
  );
}
