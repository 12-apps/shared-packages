import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { useCheckoutCopy } from "./copy-context";
import { useCheckoutComponents } from "./ui";

/**
 * What the Pagamento step says about the ORDER around the payment (FUT-3525):
 * its lines and its total, in the list's "Resumo do pedido" column on a
 * computer (`list/summary-column-body.tsx`).
 */

/** One cart line, as the host words it — the package does no money math. */
export interface CheckoutSummaryLine {
  key: string;
  quantity: number;
  name: string;
  /** The line's total, formatted by the host. */
  totalLabel: string;
}

/** Where a delivery goes, and the host's way back to change it. */
export interface CheckoutDeliverySummary {
  /** "Rua Augusta, 1500 · ap 42" — street, number and complement. */
  line1: string;
  /** "Consolação, São Paulo" — district and city. Optional. */
  line2?: string;
  /** Back to the host's address step. */
  onEdit: () => void;
}

/** The amount, the one number the whole step is about. */
function TotalAmount({
  totalLabel,
  big,
}: {
  totalLabel: string;
  big: boolean;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      sx={{
        "&& > *": {
          fontSize: big ? "2.5rem" : "1.625rem",
          lineHeight: 1.1,
          letterSpacing: big ? "-0.02em" : 0,
        },
      }}
    >
      <Text
        variant="heading"
        size="md"
        weight="bold"
        color={big ? undefined : "primary"}
        as="span"
        data-testid="pay-bar-total"
      >
        {totalLabel}
      </Text>
    </Box>
  );
}

/** The cart's lines, "2× X-Burger … R$ 36,00", when the host passed them. */
export function SummaryLines({ lines }: { lines: CheckoutSummaryLine[] }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box component="ul" data-testid="checkout-summary-lines" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
      {lines.map((line) => (
        <Box component="li" key={line.key} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
          <Text variant="body" size="sm" as="span">
            {copy.lineLabel(line.quantity, line.name)}
          </Text>
          <Text variant="body" size="sm" as="span">
            {line.totalLabel}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** "Total" and the amount on one line, the host's money rows under it. */
export function SummaryTotal({ totalLabel, discountLines }: { totalLabel: string; discountLines?: ReactNode }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box data-testid="payment-step-total" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
        <Text variant="body" size="md" weight="semibold" as="span">
          {copy.total}
        </Text>
        <TotalAmount totalLabel={totalLabel} big={false} />
      </Box>
      {discountLines}
    </Box>
  );
}
