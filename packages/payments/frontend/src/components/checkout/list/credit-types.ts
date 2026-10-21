/**
 * A balance the host holds paying part of the cart, as the "Resumo do pedido"
 * column draws it (FUT-3711). Kept apart from `./types` only for that file's
 * length; both are part of `CheckoutPaymentList` / `PaymentListCopy`.
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

/** The words of the column's credit rows (FUT-3711). */
export interface PaymentListCreditCopy {
  /**
   * "A pagar" — the row under "Total" in the computer's "Resumo do pedido"
   * column, after the host's `credit` row, naming `amountDueLabel`. Absent ⇒
   * neither row is drawn.
   */
  amountDue?: string;
}
