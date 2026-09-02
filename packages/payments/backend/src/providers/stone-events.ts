/**
 * The Pagar.me v5 event types this adapter acts on, and the subset a merchant
 * is told to subscribe to.
 *
 * Its own module because the SETUP GUIDE has to name that subset, and a guide
 * that retypes it drifts silently in the one direction that matters: an event
 * the adapter handles and no store is subscribed to is a feature that never
 * fires. That is not hypothetical — `charge.overpaid` and `charge.canceled`
 * were parsed for a year while the guide named three events, so no store could
 * receive either, and a first attempt at this fix added `charge.underpaid` to
 * that sentence and missed `charge.overpaid` sitting beside it (FUT-674). The
 * sentence is composed from {@link MERCHANT_EVENTS} now, and
 * `stone-guide-events.test.ts` fails when a handled event belongs to neither
 * that list nor {@link GUIDE_EXEMPT_EVENTS}.
 */

/** Event types that carry a charge state change. */
export const CHARGE_EVENTS = new Set([
  'charge.paid',
  'charge.payment_failed',
  'charge.pending',
  'charge.processing',
  'charge.canceled',
  'charge.underpaid',
  'charge.overpaid',
  'order.paid',
  'order.payment_failed',
  'order.canceled',
]);

/**
 * A reversal of the whole charge — which is what makes the charge's own amount
 * a usable fallback when the delivery names no `canceled_amount`. Not the
 * amount RAISED, though: `returnedCents` prefers `paid_amount`, because a
 * charge that settled short returns what it took, not what it asked for.
 */
export const FULL_REFUND_EVENTS = new Set(['charge.refunded']);

/**
 * A reversal of PART of it. `charge.partial_canceled` is the one Pagar.me
 * actually sends — `charge.partial_refunded` is nowhere in its event list, so
 * the partial half of this listener had never once fired. Kept beside the real
 * name rather than replaced by it: a listener costs nothing, and narrowing what
 * a money path listens for can only ever lose an event.
 */
const PARTIAL_REFUND_EVENTS = new Set([
  'charge.partial_canceled',
  'charge.partial_refunded',
]);

export const REFUND_EVENTS = new Set([...FULL_REFUND_EVENTS, ...PARTIAL_REFUND_EVENTS]);

/**
 * What the setup guide tells the merchant to subscribe to, in the order the
 * sentence reads. Every event here moves money, or moves an order out of
 * awaiting-payment; missing one costs a settlement.
 */
export const MERCHANT_EVENTS = [
  'charge.paid',
  'charge.payment_failed',
  'charge.underpaid',
  'charge.overpaid',
  'charge.canceled',
  'charge.refunded',
  'charge.partial_canceled',
];

/**
 * Handled, and deliberately NOT named in the guide. Each costs a reason — a
 * label is not one, and an unexplained entry here is how the list above goes
 * quietly short again.
 */
export const GUIDE_EXEMPT_EVENTS = new Map([
  [
    'charge.pending',
    'The row is already PENDING; the delivery restates what we know and moves no money.',
  ],
  ['charge.processing', 'Same — a state the charge is already recorded in.'],
  [
    'charge.partial_refunded',
    'Not in Pagar.me’s event list. Listened for defensively; telling a merchant to subscribe to it would send them looking for something that is not there.',
  ],
  [
    'order.paid',
    'Accepted so an order-level subscription still settles, but naming BOTH families doubles every delivery for a store that follows the guide literally, and the charge family is the one that carries a shortfall.',
  ],
  ['order.payment_failed', 'Same reasoning as order.paid.'],
  ['order.canceled', 'Same reasoning as order.paid.'],
]);
