import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { useCheckoutCopy } from "./copy-context";
import { useCheckoutComponents } from "./ui";

/**
 * THE MONEY LINE both steps show.
 *
 * Its own module because two steps now render it — the Dados bar always did,
 * and the Pagamento step does since FUT-1179, which is the ticket about a
 * checkout that asked for money without ever showing the amount. One
 * implementation so the two can never word the same total differently.
 */

/**
 * The totals shown on the pay bar: the settled balance's when settling a settlement
 * one, otherwise the cart's own — both supplied by the host, which
 * is the only side that knows either.
 */
export function displayTotals(
  override: { label: string; items: number } | undefined,
  cart: { totalLabel: string; totalItems: number },
): { label: string; items: number } {
  return { label: override?.label ?? cart.totalLabel, items: override?.items ?? cart.totalItems };
}

/** The pay bar's money column: item count, grand total, host discount lines. */
export function PayBarTotal({
  totalLabel,
  totalItems,
  children,
}: {
  totalLabel: string;
  totalItems: number;
  children?: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Text variant="caption" size="xs" color="secondary" as="span">
        {copy.totalCaption(totalItems)}
      </Text>
      <Text variant="heading" size="md" weight="bold" color="primary" as="span" data-testid="pay-bar-total">
        {totalLabel}
      </Text>
      {children}
    </Box>
  );
}
