import type { CustomerFieldKey, PaymentMethodKind } from '../core/types';

/**
 * EVERY buyer-facing sentence the checkout can produce, as a port (FUT-740).
 *
 * The library decides WHICH code fires, at what status, and in what order —
 * those are the money-safety rules, and they stay here. The WORDS are the
 * host's, because baking pt-BR product copy into a published package makes it
 * unportable to any host that is not this one storefront, and because a
 * sentence is a product decision a library has no standing to make.
 *
 * What the library still enforces through this seam is exactly what the copy
 * exists for: an exhausted chain gets ONE honest sentence and never the last
 * provider's words; an unresolved charge is worded so it cannot invite a second
 * payment. A host can change the wording; it cannot change which of those two
 * situations it is being asked to word.
 */
export interface CheckoutCopy {
  /** No provider is connected — the merchant cannot take payment at all. */
  notConfigured: string;
  /**
   * The whole chain refused. NAMED BY METHOD, never by "payment methods": in a
   * storefront that phrase is the buyer's word for the tiles in the picker, so
   * "none of this store's payment methods worked" told a shopper whose CARD
   * charge exhausted the chain that PIX would not work either — and a chain can
   * exhaust on CARD purely because no instrument was minted for its tail while
   * every provider in it still charges PIX fine.
   */
  chainExhausted(method: PaymentMethodKind): string;
  /**
   * A charge NOBODY can confirm yet. Must not invite a second payment — some
   * provider may be holding the money — and must not promise something the
   * screen does not do.
   */
  unresolvedCharge: string;
  /** The charge that came back is not this attempt's; nothing was recorded. */
  chargeMismatch: string;
  /** A saved instrument this merchant/provider pair cannot charge (FUT-697). */
  instrumentNotUsableHere: string;
  /** No payable under that handle — or not this caller's. Indistinguishable. */
  payableNotFound: string;
  /** One or more buyer fields are absent (FUT-595). */
  buyerFieldMissing(fields: readonly CustomerFieldKey[]): string;
  /** A buyer field is present but the provider will not accept it. */
  buyerFieldInvalid(field: CustomerFieldKey): string;
  /**
   * The `field` value the CLIENT highlights for a buyer field — the wire name,
   * which is a host/client contract rather than a library one (`taxId` is
   * `cpf` in a Brazilian storefront).
   */
  fieldNameOf(field: CustomerFieldKey): string;
  /** Nothing more specific applies. Never a provider's own sentence. */
  genericProviderRefusal: string;
}

/** "a", "a e b", "a, b e c" — the Portuguese list separator, not a comma run. */
function joinPt(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/**
 * How each buyer field is named to a pt-BR buyer. `ask` is the prompt form
 * ("informe seu CPF"), `noun` the subject form ("O CPF informado…") — both
 * masculine, so one article works for all of them.
 */
const PT_BR_FIELDS: Record<CustomerFieldKey, { field: string; ask: string; noun: string }> = {
  taxId: { field: 'cpf', ask: 'seu CPF', noun: 'CPF' },
  email: { field: 'email', ask: 'seu e-mail', noun: 'e-mail' },
  name: { field: 'name', ask: 'seu nome completo', noun: 'nome' },
  phone: { field: 'phone', ask: 'seu celular', noun: 'celular' },
};

/**
 * The strings future-pay's checkout serves today, verbatim, so adopting the
 * mount changes no sentence a buyer reads. Exported as the DEFAULT rather than
 * hardcoded: a host outside Brazil passes its own and loses nothing.
 */
export const defaultCheckoutCopyPtBR: CheckoutCopy = {
  notConfigured:
    'Esta loja ainda não está pronta para receber pagamentos online. Combine o pagamento ' +
    'diretamente com a loja, ou peça ao lojista para ativar o sistema de pagamento em ' +
    'Configuração → Sistema de pagamento.',

  chainExhausted(method) {
    const failed = method === 'CARD' ? 'com cartão' : 'com PIX';
    const survivor = method === 'CARD' ? 'pague com PIX' : 'pague com cartão';
    return (
      `Não conseguimos concluir o pagamento ${failed} agora. ` +
      `Tente novamente em instantes, ${survivor} ou combine o pagamento diretamente com a loja.`
    );
  },

  unresolvedCharge:
    'Estamos confirmando o seu pagamento com o provedor. NÃO pague de novo — se a cobrança ' +
    'foi feita, ela será confirmada sozinha. Confira o seu pedido em alguns minutos ou fale ' +
    'com a loja.',

  chargeMismatch:
    'Não foi possível confirmar esta cobrança. Atualize a página e tente novamente.',

  instrumentNotUsableHere:
    'Este cartão salvo não está disponível nesta loja. Informe os dados do cartão novamente ' +
    'para pagar.',

  payableNotFound: 'Pedido não encontrado.',

  buyerFieldMissing(fields) {
    const asked = joinPt(fields.map((field) => PT_BR_FIELDS[field].ask));
    return `Para concluir o pagamento, informe ${asked}.`;
  },

  buyerFieldInvalid(field) {
    return `O ${PT_BR_FIELDS[field].noun} informado não é válido. Confira e tente novamente.`;
  },

  fieldNameOf(field) {
    return PT_BR_FIELDS[field].field;
  },

  genericProviderRefusal:
    'O provedor de pagamento recusou a cobrança. Verifique seus dados e tente novamente.',
};
