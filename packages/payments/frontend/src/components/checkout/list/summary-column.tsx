import { Box } from "@mui/material";
import { createContext, useContext, type JSX, type ReactNode } from "react";

import { useCheckoutCopy } from "../copy-context";
import { SummaryLines, SummaryTotal, type CheckoutSummaryLine } from "../payment-summary";
import { useCheckoutComponents } from "../ui";

/**
 * Where the bar's content goes on a computer (FUT-3685, L4): into the
 * "Resumo do pedido" column — an element the column draws, which the bar's
 * content is portalled into — or `null` on a phone, where the bar stays the
 * host's sticky `ActionBar` (L2).
 */
const ColumnTarget = createContext<{ element: HTMLElement | null } | null>(null);

export const SummaryColumnTarget = ColumnTarget.Provider;

/**
 * `null` for the bar (a phone); otherwise the column's element to portal the
 * bar's content into — itself `null` for the one render before the column
 * mounts, when nothing is drawn rather than a bar that would flash.
 */
export function useSummaryColumnTarget(): { element: HTMLElement | null } | null {
  return useContext(ColumnTarget);
}

/** The prototype's 680px steps column and 360px summary column, on the theme's spacing scale. */
const STEPS_MAX = 85;
const COLUMN_WIDTH = 45;

/**
 * The computer's two columns (L4): the steps on the left, at most ~680px, and
 * the "Resumo do pedido" column on the right, ~360px, holding the lines, the
 * fees, "Total", the host's context line and the pay button — so no bar sits
 * at the bottom of the screen.
 */
export function TwoColumns({ steps, column }: { steps: ReactNode; column: ReactNode }): JSX.Element {
  return (
    <Box data-testid="list-columns" sx={{ display: "flex", gap: 4, alignItems: "flex-start", justifyContent: "center", width: "100%" }}>
      <Box sx={{ flex: 1, minWidth: 0, maxWidth: (t) => t.spacing(STEPS_MAX) }}>{steps}</Box>
      <Box sx={{ flex: "none", width: (t) => t.spacing(COLUMN_WIDTH), position: "sticky", top: (t) => t.spacing(3) }}>{column}</Box>
    </Box>
  );
}

/**
 * "Resumo do pedido" (T20): the cart's lines and the host's money rows (fees,
 * discounts) as the host words them, a hairline, "Total" and the amount — and
 * under them `slot`, the element the bar's content is portalled into.
 */
export function SummaryColumn({ lines, moneyLines, totalLabel, slot }: {
  lines?: CheckoutSummaryLine[];
  /** The host's fee and discount rows (`CheckoutCartView.discountLines`). */
  moneyLines?: ReactNode;
  totalLabel: string;
  slot: (element: HTMLElement | null) => void;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  const shown = lines ?? [];
  return (
    <Box
      component="aside"
      aria-label={copy.summaryTitle}
      data-testid="list-summary-column"
      sx={{ display: "flex", flexDirection: "column", gap: 1.75, p: 2.75, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3.5 }}
    >
      <Text variant="heading" size="md" weight="bold" as="h2" style={{ margin: 0 }}>
        {copy.summaryTitle}
      </Text>
      {shown.length > 0 ? <SummaryLines lines={shown} /> : null}
      {moneyLines ? <Box data-testid="list-summary-money">{moneyLines}</Box> : null}
      <Box sx={{ height: "1px", bgcolor: "divider" }} />
      <SummaryTotal totalLabel={totalLabel} />
      <Box ref={slot} data-testid="list-summary-action" sx={{ display: "flex", flexDirection: "column" }} />
    </Box>
  );
}
