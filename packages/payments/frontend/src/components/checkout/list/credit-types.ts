import type { CheckoutSummaryLine } from "../payment-summary";

/**
 * What the "Resumo do pedido" column draws beyond the cart: a balance the host
 * holds paying part of it (FUT-3711), and the host's own lines (FUT-3692).
 * Kept apart from `./types` only for that file's length; both are part of
 * `CheckoutPaymentList` / `PaymentListCopy`.
 */
export interface PaymentListCredit {
  /**
   * The balance that pays part of the cart, as the host words and formats it
   * — `{ label: "Crédito da loja", amountLabel: "− R$ 5,00" }`. With
   * `amountDueLabel`, the computer's "Resumo do pedido" column draws it under
   * "Total", then "A pagar" (`copy.amountDue`) and the amount due, so Total −
   * credit reads as what the button charges — while an ONLINE option is
   * chosen. A door option or no choice charges the cart's total, so "Total"
   * stands alone. Absent ⇒ "Total" alone.
   */
  credit?: { label: string; amountLabel: string };
}

/** The lines the computer's "Resumo do pedido" column draws above "Total". */
export interface PaymentListSummary {
  /**
   * The host's lines for the "Resumo do pedido" column — quantity, name and
   * the host's formatted total — drawn above "Total" in place of the cart's.
   *
   * For a checkout whose total is READY rather than the cart's (a settlement:
   * a comanda's conta, a balance), where the cart is not what is being paid
   * and its lines are not drawn: the host knows what the total is made of,
   * and says it here. Absent ⇒ the cart's lines, or none beside a ready
   * total, as before. The column only — the phone draws no lines either way.
   */
  lines?: CheckoutSummaryLine[];
}

/** The words of the column's credit rows (FUT-3711). */
export interface PaymentListCreditCopy {
  /**
   * "A pagar" — the row under "Total" in the computer's "Resumo do pedido"
   * column, after the host's `credit` row, naming `amountDueLabel`. Absent ⇒
   * neither row is drawn.
   */
  amountDue?: string;
}
