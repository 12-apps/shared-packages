/**
 * Extra correlation a provider needs to CONFIRM a settlement, beyond the
 * host's own reference.
 *
 * Some providers do not accept "did reference X get paid?" as a question.
 * InfinitePay's `payment_check` takes `handle`, `order_nsu`, `transaction_nsu`
 * and `slug` together: the reference alone answers "not paid" indefinitely,
 * which is precisely what a genuinely paid R$ 1,01 got, right up to the
 * timeout that then blamed the payer.
 *
 * Both fields become knowable at different moments — `slug` when the charge is
 * created, `transactionNsu` only once the buyer has actually paid (it arrives
 * on the return redirect and on the webhook) — so this is a bag of what the
 * caller happens to hold, never a contract that either is present. An adapter
 * that needs neither ignores it.
 *
 * Its own module purely so `core/types.ts` stays inside the size gate.
 */
export interface SettlementHints {
  /** Provider-side invoice/checkout code, learned when the charge was created. */
  slug?: string;
  /** Provider-side transaction id, learned only once the payment happened. */
  transactionNsu?: string;
  /**
   * Provider-side ORDER (container) id the charge lives under, when the
   * provider keys its read API by order rather than by charge (FUT-681).
   *
   * PagBank is the case: an unpaid PIX order carries NO charge at all — the
   * charge is minted only when the buyer pays — so at creation the order id is
   * the only identity in existence, and `GET /orders/{id}` stays the one poll
   * that answers for both paid and unpaid states. Carrying it here (instead of
   * smuggling it through `providerChargeId`) is what lets `providerChargeId`
   * become the real charge id the moment one exists, and what lets the charge
   * store re-key a row recorded under the order id when the paid webhook
   * finally names the charge.
   */
  orderId?: string;
}
