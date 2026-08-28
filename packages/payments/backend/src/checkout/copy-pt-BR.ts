import type { CustomerFieldKey } from '../core/customer-schema';

import type { CheckoutCopy } from './copy';

/**
 * Every buyer-facing sentence the checkout can produce, in Portuguese
 * (FUT-764).
 *
 * ## This revisits FUT-740, and the difference is the whole argument
 *
 * `./copy.ts` used to carry a pt-BR table BELOW the interface, and deleting it
 * was right: it was a DEFAULT. Nothing had to ask for it, so a host that
 * supplied no copy silently rendered one storefront's sentences, and the
 * docstring that survives there is still correct about that.
 *
 * A named pack is the opposite arrangement. `CheckoutCopy` stays REQUIRED —
 * `checkoutRefusalFor` reads nothing from here, and there is still no way to
 * render a sentence the host did not choose. What changes is only that a host
 * choosing these ones does not have to retype them. That is the shape
 * `ACTIVATION_COPY`, `CONNECT_APPLICATION_COPY` and `PROVIDER_COPY` already
 * ship in on `../locales`, and the nine on `@12-apps/payments-frontend`.
 *
 * The measurement that prompted it: the first adopting host was maintaining 97
 * lines of this, for sentences that describe outcomes THIS package decides —
 * which provider chain exhausted, on which method, and whether a charge is
 * unresolved. A second adopter would write them again, word for word.
 *
 * ## What a host still has to answer for itself
 *
 * `fieldNameOf` is a host/client contract, not copy: it names the input the
 * BROWSER highlights, so `taxId` is `cpf` in one storefront and something else
 * in the next. The value below is the wire name the package's own schemas use;
 * a host whose client reacts on different names overrides it.
 *
 * `notConfigured` names a console path — where an owner goes to turn payments
 * on — and no package can know it. What is here says only what is true
 * everywhere, and a host with a settings screen to point at should override
 * this one key.
 */

/**
 * How each buyer field is named to the buyer, and in two forms: `ask` is the
 * prompt ("informe seu CPF"), `noun` the subject ("O CPF informado…").
 *
 * Both masculine so one article works, which is a property of the WORDS rather
 * than of the fields — and exactly the kind of thing a translation is allowed
 * to change, which is why the en-US twin builds its sentences its own way.
 */
const BUYER_FIELDS: Record<CustomerFieldKey, { ask: string; noun: string }> = {
  taxId: { ask: 'seu CPF', noun: 'CPF' },
  email: { ask: 'seu e-mail', noun: 'e-mail' },
  name: { ask: 'seu nome completo', noun: 'nome' },
  phone: { ask: 'seu celular', noun: 'celular' },
};

/** "a", "a e b", "a, b e c" — the Portuguese list separator, not a comma run. */
function joinPt(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

export const PT_BR_CHECKOUT_COPY: CheckoutCopy = {
  notConfigured:
    'Esta loja ainda não está pronta para receber pagamentos online. Combine o pagamento ' +
    'diretamente com a loja.',

  /**
   * NAMED BY METHOD, never by "meios de pagamento": in a storefront that phrase
   * is the buyer's word for the tiles in the picker, so "nenhum meio funcionou"
   * told a shopper whose CARD charge exhausted the chain that PIX would not
   * work either — when a chain can exhaust on CARD purely because no instrument
   * was minted for its tail, while every provider still charges PIX fine.
   */
  chainExhausted(method) {
    const failed = method === 'CARD' ? 'com cartão' : 'com PIX';
    const survivor = method === 'CARD' ? 'pague com PIX' : 'pague com cartão';
    return (
      `Não conseguimos concluir o pagamento ${failed} agora. ` +
      `Tente novamente em instantes, ${survivor} ou combine o pagamento diretamente com a loja.`
    );
  },

  /** Must not invite a second payment — some provider may be holding the money. */
  unresolvedCharge:
    'Estamos confirmando o seu pagamento com o provedor. NÃO pague de novo — se a cobrança ' +
    'foi feita, ela será confirmada sozinha. Confira o seu pedido em alguns minutos ou fale ' +
    'com a loja.',

  chargeMismatch: 'Não foi possível confirmar esta cobrança. Atualize a página e tente novamente.',

  instrumentNotUsableHere:
    'Este cartão salvo não está disponível nesta loja. Informe os dados do cartão novamente ' +
    'para pagar.',

  payableNotFound: 'Pedido não encontrado.',

  buyerFieldMissing(fields) {
    return `Para concluir o pagamento, informe ${joinPt(fields.map((f) => BUYER_FIELDS[f].ask))}.`;
  },

  buyerFieldInvalid(field) {
    return `O ${BUYER_FIELDS[field].noun} informado não é válido. Confira e tente novamente.`;
  },

  /**
   * The name the BROWSER's form field carries, which is a host/client contract
   * rather than copy — the package calls it `taxId` and a Brazilian storefront
   * calls it `cpf`, and a pack that "translated" `cpf` back would leave the
   * buyer staring at a form with no field marked and no way to tell why. What
   * is here is that convention; a host whose form differs overrides this key.
   */
  fieldNameOf: (field) => (field === 'taxId' ? 'cpf' : field),

  /** Never a provider's own sentence — see `mapProviderError` for the mapped ones. */
  genericProviderRefusal:
    'O provedor de pagamento recusou a cobrança. Verifique seus dados e tente novamente.',
};
