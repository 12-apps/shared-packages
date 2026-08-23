import { parseMoneyToCents } from './money';
import { normalizeText } from './text';
import type { MarketVocabulary } from './vocabulary';

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

// The three word patterns below are the MARKET's, not this module's
// (FUT-760) — see `./vocabulary`. What each one MEANS is stated here, because
// that is the part a pack must not redecide:
//
//   freeDelivery      matched against `normalizeText` output, so one pattern
//                     holds for every casing and both spellings a vendor may
//                     send ("GRÁTIS" / "gratis").
//   conditionalFree   "Frete GRÁTIS em pedidos acima de R$ 79" is NOT free
//                     shipping for this offer. It is free ABOVE a basket
//                     minimum this research knows nothing about, and a price
//                     search is usually pricing a single unit far below it.
//                     Reading it as 0 is exactly the understatement FUT-518
//                     exists to remove: the buyer meets the real freight at
//                     checkout, after the offer has already won
//                     cheapest-first. Unknown is the honest answer — a
//                     surface can caveat unknown; it cannot caveat a
//                     confident zero.
//   installment       a financing term; see `./vocabulary`.

// The R$ token is cut out BEFORE parsing so a neighbouring number (an order
// minimum, a CEP, a unit count) can never leak into the amount — the same
// guard serp.ts already applies to extension prices.
const BRL_AMOUNT = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/i;

const statedAmountCents = (text: string, installment: RegExp): number | undefined => {
  if (installment.test(text)) return undefined;
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
  vocabulary: Pick<MarketVocabulary, 'freeDelivery' | 'conditionalFree' | 'installment'>,
): number | undefined => {
  const stated = texts.filter((entry): entry is string => Boolean(entry));
  // Free wins over any amount in the same batch: a merchant showing both is
  // running a promotion over its table price, and the promotion is what the
  // buyer pays today. An UNCONDITIONAL free claim only — see CONDITIONAL_FREE.
  const free = stated
    .map((text) => normalizeText(text))
    .filter((text) => vocabulary.freeDelivery.test(text));
  if (free.length > 0) {
    return free.some((text) => vocabulary.conditionalFree.test(text)) ? undefined : 0;
  }
  for (const text of stated) {
    const cents = statedAmountCents(text, vocabulary.installment);
    if (cents !== undefined) return cents;
  }
  return undefined;
};
