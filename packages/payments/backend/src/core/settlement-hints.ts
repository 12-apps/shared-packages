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
}
