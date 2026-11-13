/**
 * The Manual do DANFE NFC-e's own texts, in Portuguese — a named pack, the
 * words a Brazilian host passes as `labels`. The legal phrases (the title,
 * the homologation and contingency notices) are the Manual's, verbatim.
 */

import type { DanfeNfceLabels } from "./labels";

export const DANFE_NFCE_PT_BR: DanfeNfceLabels = {
  cnpj: "CNPJ",
  stateRegistration: "IE",
  title: "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica",
  itemsHeader: "CÓDIGO DESCRIÇÃO QTDE UN VL UNIT VL TOTAL",
  itemCount: "Qtde. total de itens",
  totalValue: "Valor total R$",
  discounts: "Descontos R$",
  amountDue: "Valor a Pagar R$",
  paymentHeader: "FORMA PAGAMENTO / VALOR PAGO R$",
  change: "Troco R$",
  paymentMethods: {
    "01": "Dinheiro",
    "02": "Cheque",
    "03": "Cartão de Crédito",
    "04": "Cartão de Débito",
    "05": "Crédito Loja",
    "10": "Vale Alimentação",
    "11": "Vale Refeição",
    "12": "Vale Presente",
    "13": "Vale Combustível",
    "15": "Boleto Bancário",
    "16": "Depósito Bancário",
    "17": "PIX Dinâmico",
    "18": "Transferência bancária",
    "19": "Programa de fidelidade",
    "20": "PIX Estático",
    "90": "Sem pagamento",
    "99": "Outros",
  },
  lookupByKey: "Consulte pela Chave de Acesso em",
  homologation: "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL",
  contingency: "EMITIDA EM CONTINGÊNCIA",
  pendingAuthorization: "Pendente de autorização",
  consumerCopy: "Via consumidor",
  consumer: "CONSUMIDOR",
  unidentifiedConsumer: "CONSUMIDOR NÃO IDENTIFICADO",
  number: "NFC-e nº",
  series: "Série",
  protocol: "Protocolo de autorização:",
  authorizedAt: "Data de autorização:",
  qrCaption: "Consulta via leitor de QR Code",
  approximateTaxes: "Tributos totais incidentes (Lei Federal 12.741/2012) R$",
};
