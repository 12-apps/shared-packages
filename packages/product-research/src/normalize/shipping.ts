import { parseMoneyToCents } from './money';
import { normalizeText } from './text';

/**
 * Shipping cost read from a merchant's own delivery line (FUT-518).
 *
 * Both paid connectors already RECEIVE this text and only one of them read it:
 * `amazon.ts` kept a private free-delivery regex while every Google Shopping
 * offer reported unknown shipping despite carrying a `delivery` string. One
 * helper removes both halves of that — the silent drop and the second parser
 * that could drift over the same vendor strings.
 *
 * Anything unrecognized stays `undefined`. That is the point of the ticket: a
 * total built on an invented freight figure is worse than one the surface can
 * label as incomplete, because the buyer only discovers the difference at
 * checkout.
 *
 * FEED THIS THE DELIVERY FIELD ONLY. It must never see Google's `extensions`,
 * which carry INSTALLMENT prices ("R$ 3,79 em 12x" — see EXTENSION_PRICE in
 * serp.ts): parsing one as freight would report a financing term as a shipping
 * cost the merchant never quoted. The installment guard below is a second line
 * of defence for a delivery line that happens to quote financing, not a licence
 * to widen the input.
 */

// Matched against `normalizeText` output, so it holds for every casing and for
// both spellings the vendors send interchangeably ("GRÁTIS" / "gratis").
const FREE_DELIVERY = /(?:frete|entrega|envio)\s+gratis/;

// "Frete GRÁTIS em pedidos acima de R$ 79" is NOT free shipping for this offer.
// It is free ABOVE a basket minimum this research knows nothing about, and a
// price search is usually pricing a single unit far below it. Reading it as 0
// is exactly the understatement FUT-518 exists to remove: the buyer meets the
// real freight at checkout, after the offer has already won cheapest-first.
// Unknown is the honest answer — a surface can caveat unknown; it cannot
// caveat a confident zero.
const CONDITIONAL_FREE = /\b(?:acima|a partir|para compras|minimo)\b/;

// The R$ token is cut out BEFORE parsing so a neighbouring number (an order
// minimum, a CEP, a unit count) can never leak into the amount — the same
// guard serp.ts already applies to extension prices.
const BRL_AMOUNT = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/i;

// "em 12x", "12x sem juros", "3 parcelas": a financing term. A delivery line
// quoting one states nothing about freight, so it must resolve to unknown
// rather than to the instalment value.
const INSTALLMENT = /\d+\s*x\b|sem\s+juros|parcela/i;

const statedAmountCents = (text: string): number | undefined => {
  if (INSTALLMENT.test(text)) return undefined;
  const token = BRL_AMOUNT.exec(text)?.[0];
  const cents = token === undefined ? null : parseMoneyToCents(token);
  return cents !== null && cents >= 0 ? cents : undefined;
};

/**
 * `0` = the merchant stated free delivery, `n` = the merchant stated `n` cents,
 * `undefined` = the merchant said nothing a parser can trust.
 */
export const shippingCentsFromText = (
  texts: readonly (string | null | undefined)[],
): number | undefined => {
  const stated = texts.filter((entry): entry is string => Boolean(entry));
  // Free wins over any amount in the same batch: a merchant showing both is
  // running a promotion over its table price, and the promotion is what the
  // buyer pays today. An UNCONDITIONAL free claim only — see CONDITIONAL_FREE.
  const free = stated
    .map((text) => normalizeText(text))
    .filter((text) => FREE_DELIVERY.test(text));
  if (free.length > 0) {
    return free.some((text) => CONDITIONAL_FREE.test(text)) ? undefined : 0;
  }
  for (const text of stated) {
    const cents = statedAmountCents(text);
    if (cents !== undefined) return cents;
  }
  return undefined;
};
