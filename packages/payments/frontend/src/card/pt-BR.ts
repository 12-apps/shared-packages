import type { CardCopy } from './copy';

/**
 * The pt-BR pack for the card form — a NAMED constant a host passes by hand,
 * never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the form used to render, so a host adopting it sees no change on screen —
 * what changes is that the words are chosen in a diff.
 */
export const PT_BR_CARD_COPY: CardCopy = {
  fields: {
    unknownBrand: 'Cartão',
    numberLabel: 'Número do cartão',
    numberRequired: 'Informe o número do cartão.',
    numberIncomplete: 'Número de cartão incompleto.',
    numberInvalid: 'Número de cartão inválido.',
    holderLabel: 'Nome impresso no cartão',
    holderRequired: 'Informe o nome impresso no cartão.',
    expiryLabel: 'Validade (MM/AA)',
    cvvLabel: 'CVV',
    monthInvalid: 'Mês inválido.',
    expired: 'Cartão expirado.',
    expiryInvalid: 'Validade inválida ou expirada.',
    cvvInvalid: 'CVV inválido.',
    cvvDigits: (length) => `CVV deve ter ${length} dígitos.`,
    cpfRequired: 'CPF obrigatório.',
    cpfInvalid: 'CPF inválido.',
    savedCardsLabel: 'Cartão',
    newCard: 'Novo cartão',
    newCardDescription: 'Inserir outro cartão',
    saveCard: 'Salvar cartão para próximas compras',
  },
  tokenize: {
    sdkUnavailable: 'Não foi possível carregar o meio de pagamento. Recarregue a página.',
    cardNotProcessed:
      'Não foi possível processar o cartão. Verifique os dados e tente novamente.',
    providerUnreachable:
      'Não foi possível contatar o provedor do cartão. Verifique sua conexão.',
    providerTimedOut: 'O provedor do cartão não respondeu a tempo.',
    providerRefused: (status, response) =>
      `O provedor recusou os dados do cartão (HTTP ${status}). ` +
      `Resposta: ${response}`,
    noPublicKey:
      'A chave pública do cartão não está disponível para esta loja. ' +
      'Reconecte o provedor e tente novamente.',
    cardUnavailable:
      'O pagamento com cartão está indisponível nesta loja no momento. Recarregue a página e tente de novo, escolha outro método de pagamento ou combine diretamente com a loja.',
  },
};
