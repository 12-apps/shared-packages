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

