// RULE 2 violation fixture — linted as packages/ui/src/<file>, i.e. a sibling
// package that is not payments.
//
// A plain literal, a record keyed by vendor, a template chunk and an import
// specifier: the four shapes a vendor name actually shows up in when a consumer
// starts to fork.
export const DEFAULT_PROVIDER = 'pagbank';
export const LABELS = { stripe: 'Cartão internacional' };
export const WEBHOOK = `/api/webhooks/pagseguro/${DEFAULT_PROVIDER}/notifications`;

export async function loadAdapter() {
  return import('@12-apps/payments-backend/providers/infinitepay');
}
