import type { CustomerFieldKey } from '../core/customer-schema';

import type { CheckoutCopy } from './copy';

/**
 * The twin of `./copy-pt-BR.ts`, key for key (FUT-764). See that file for why a
 * named pack is a different arrangement from the DEFAULT this package deleted
 * in FUT-740, and for the two keys a host still answers for itself.
 *
 * **PIX** deliberately does not move across the pair: it is the instrument's
 * own name, what the buyer's bank statement says and what the tile in the
 * picker says, in every language.
 */

/**
 * How each buyer field is named to the buyer.
 *
 * `ask` is the prompt ("your tax ID"), `noun` the subject ("The tax ID you
 * entered…"). English needs no gender agreement, so unlike the pt-BR pack there
 * is no article to keep consistent — the two forms stay separate only so the
 * sentences below read naturally rather than being assembled from one.
 *
 * CPF is kept as the parenthetical: a Brazilian buyer reading English still has
 * a CPF, and "tax ID" alone would leave them guessing which number is wanted.
 */
const BUYER_FIELDS: Record<CustomerFieldKey, { ask: string; noun: string }> = {
  taxId: { ask: 'your tax ID (CPF)', noun: 'tax ID (CPF)' },
  email: { ask: 'your email', noun: 'email' },
  name: { ask: 'your full name', noun: 'name' },
  phone: { ask: 'your mobile number', noun: 'mobile number' },
};

/** "a", "a and b", "a, b and c" — the English list separator. */
function joinEn(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const EN_US_CHECKOUT_COPY: CheckoutCopy = {
  notConfigured:
    'This store is not set up to take online payments yet. Arrange payment directly with the ' +
    'store.',

  /**
   * NAMED BY METHOD, never by "payment methods": in a storefront that phrase is
   * the buyer's word for the tiles in the picker, so "no payment method worked"
   * told a shopper whose CARD charge exhausted the chain that PIX would not
   * work either — when a chain can exhaust on CARD purely because no instrument
   * was minted for its tail, while every provider still charges PIX fine.
   */
  chainExhausted(method) {
    const failed = method === 'CARD' ? 'by card' : 'with PIX';
    const survivor = method === 'CARD' ? 'pay with PIX' : 'pay by card';
    return (
      `We could not complete the payment ${failed} right now. ` +
      `Try again in a moment, ${survivor}, or arrange payment directly with the store.`
    );
  },

  /** Must not invite a second payment — some provider may be holding the money. */
  unresolvedCharge:
    'We are confirming your payment with the provider. DO NOT pay again — if the charge went ' +
    'through, it will be confirmed on its own. Check your order in a few minutes or contact ' +
    'the store.',

  chargeMismatch: 'We could not confirm this charge. Refresh the page and try again.',

  instrumentNotUsableHere:
    'This saved card is not available at this store. Enter the card details again to pay.',

  payableNotFound: 'Order not found.',

  buyerFieldMissing(fields) {
    return `To complete the payment, enter ${joinEn(fields.map((f) => BUYER_FIELDS[f].ask))}.`;
  },

  buyerFieldInvalid(field) {
    return `The ${BUYER_FIELDS[field].noun} you entered is not valid. Check it and try again.`;
  },

  /** The same host/client contract the pt-BR half carries — see its note. */
  fieldNameOf: (field) => (field === 'taxId' ? 'cpf' : field),

  /** The twin of the pt-BR key — see its note for the three refusals it words. */
  genericProviderRefusal:
    'The payment provider could not complete the request right now. Try again in a moment.',
};
