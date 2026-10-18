import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { useCheckoutCopy } from "../copy-context";
import { SummaryLines, SummaryTotal, type CheckoutSummaryLine } from "../payment-summary";
import { useCheckoutComponents } from "../ui";

/** What the "Resumo do pedido" column is handed by the layout. */
export interface ColumnProps {
  lines?: CheckoutSummaryLine[];
  /** The host's fee and discount rows (`CheckoutCartView.discountLines`). */
  moneyLines?: ReactNode;
  totalLabel: string;
  /**
   * A balance paying part of the cart, and what is left to pay (FUT-3711):
   * drawn under "Total" so Total − credit reads as what the button charges.
   */
  credit?: { label: string; amountLabel: string; dueTitle: string; dueLabel: string };
  slot: (element: HTMLElement | null) => void;
}

/** One label/amount row under "Total". */
function AmountRow({ label, amount, strong = false, testId }: { label: string; amount: string; strong?: boolean; testId: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const weight = strong ? "semibold" : undefined;
  return (
    <Box data-testid={testId} sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
      <Text variant="body" size={strong ? "md" : "sm"} weight={weight} color={strong ? undefined : "secondary"} as="span">
        {label}
      </Text>
      <Box component="span" sx={{ flex: "none", whiteSpace: "nowrap" }}>
        <Text variant="body" size={strong ? "md" : "sm"} weight={weight} color={strong ? undefined : "secondary"} as="span">
          {amount}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * "Resumo do pedido" (T20): the cart's lines and the host's money rows (fees,
 * discounts) as the host words them, a hairline, "Total" and the amount — and
 * under them `slot`, the element the bar's content is portalled into.
 */
export function SummaryColumn({ lines, moneyLines, totalLabel, credit, slot }: ColumnProps): JSX.Element {
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
      {credit ? (
        <Box data-testid="list-summary-credit" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          <AmountRow label={credit.label} amount={credit.amountLabel} testId="list-summary-credit-row" />
          <AmountRow label={credit.dueTitle} amount={credit.dueLabel} strong testId="list-summary-due-row" />
        </Box>
      ) : null}
      <Box ref={slot} data-testid="list-summary-action" sx={{ display: "flex", flexDirection: "column" }} />
    </Box>
  );
}
