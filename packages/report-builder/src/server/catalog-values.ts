import type { FieldValueOption } from '../types';

/**
 * The closed value sets the reports catalog filters by (FUT-391).
 *
 * These MIRROR the DB CHECK constraints on their columns — `orders.status` is
 * `AWAITING_PAYMENT | PAID | FAILED | EXPIRED` in the migration, and this list
 * says the same thing in the same order. Adding a state to the schema means
 * adding it here, or the builder simply cannot express a filter for it.
 *
 * The labels are DISPLAY ONLY. A stored spec always carries the code, so
 * rewording a label never rewrites a saved report.
 *
 * They live in their own module rather than inline in the catalog because the
 * catalog is at its size limit, and because a value set is the kind of thing
 * that gets compared against a migration during review — easier when it is not
 * buried in three hundred lines of field declarations.
 */

/** `orders.status` — the webhook-owned payment lifecycle of an order. */
export const ORDER_STATUS_VALUES: readonly FieldValueOption[] = [
  { value: 'PAID', label: 'Pago' },
  { value: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' },
  { value: 'FAILED', label: 'Falhou' },
  { value: 'EXPIRED', label: 'Expirado' },
];

/**
 * `orders.method` — includes WAITER ("pagar com o garçom"), which is a way to
 * settle an ORDER but never a way to take a payment, so it has no counterpart
 * in {@link PAYMENT_METHOD_VALUES}.
 */
export const ORDER_METHOD_VALUES: readonly FieldValueOption[] = [
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
  { value: 'WAITER', label: 'Com o garçom' },
];

/** `payments.method` — a charge is only ever online. */
export const PAYMENT_METHOD_VALUES: readonly FieldValueOption[] = [
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
];

/**
 * `payments.status` — the gateway's own lifecycle, deliberately NOT the
 * order's: a payment can be AUTHORIZED (held, not captured) and an order
 * cannot, and an order can EXPIRE where a payment is DECLINED.
 */
export const PAYMENT_STATUS_VALUES: readonly FieldValueOption[] = [
  { value: 'PAID', label: 'Pago' },
  { value: 'AUTHORIZED', label: 'Autorizado' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'DECLINED', label: 'Recusado' },
];
