import type { ActivationCopy } from './copy';

/**
 * The pt-BR pack for the activation flow — a NAMED constant a host passes by
 * hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the flow used to produce, so a host adopting it sees no change on screen —
 * what changes is that the words are chosen in a diff.
 */
export const PT_BR_ACTIVATION_COPY: ActivationCopy = {
  connectFirst: 'Conecte a conta antes de verificar a cobrança.',
  noPaymentUrl: 'O provedor não devolveu a URL de pagamento.',
  stillProcessing:
    'A cobrança de teste anterior ainda está em processamento. Tente de novo em instantes.',
  expired: 'A cobrança expirou. Geramos outra sem custo quando você quiser.',
  instrumentDeclined:
    'O pagamento foi recusado pelo seu meio de pagamento. Tente outro cartão ou pague por Pix.',
  chargeDeclined: (providerReason) => `A cobrança de teste foi recusada (${providerReason}).`,
  chargeNotApproved: (status) => `A cobrança de teste não foi aprovada (${status}).`,
  awaitingPayment: 'Aguardando o pagamento.',
  unpollable: (providerName) => `Provedor desconhecido: ${providerName}`,
  unreachable: (providerName) =>
    `Não conseguimos falar com a ${providerName} agora. Tente de novo em instantes.`,
  platformApproval:
    'O PagBank ainda não liberou cobranças reais para esta plataforma. Isso é resolvido ' +
    'por nós, não pela sua loja — nossa equipe já está tratando e avisaremos assim que ' +
    'estiver liberado.',
};
