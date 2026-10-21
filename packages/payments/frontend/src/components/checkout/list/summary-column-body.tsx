import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { SummaryLines, SummaryTotal, type CheckoutSummaryLine } from "../payment-summary";
import { useCheckoutComponents } from "../ui";

/** What the loaded half of "Resumo do pedido" is handed by the layout. */
export interface ColumnBodyProps {
  lines?: CheckoutSummaryLine[];
  /** The host's fee and discount rows (`CheckoutCartView.discountLines`). */
  moneyLines?: ReactNode;
  totalLabel: string;
  /**
   * A balance paying part of the cart, and what is left to pay (FUT-3711):
   * drawn under "Total" so Total − credit reads as what the button charges.
   */
  credit?: { label: string; amountLabel: string; dueTitle: string; dueLabel: string };
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
 * What "Resumo do pedido" loads (T20, FUT-3711): the cart's lines and the
 * host's money rows (fees, discounts) as the host words them, a hairline,
 * "Total" and the amount, and the credit and "A pagar" rows. The frame, the
 * heading and the pay-button slot under them are the layout's own — eager —
 * so the bar's content never changes element when this lands.
 */
export function SummaryBody({ lines, moneyLines, totalLabel, credit }: ColumnBodyProps): JSX.Element {
  const shown = lines ?? [];
  return (
    <Box data-testid="list-summary-body" sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
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
    </Box>
  );
}
