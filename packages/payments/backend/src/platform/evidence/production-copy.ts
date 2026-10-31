import { EN_US_HOMOLOGACAO_EVIDENCE_COPY } from './en-US';
import { PT_BR_HOMOLOGACAO_EVIDENCE_COPY } from './pt-BR';
import type { EvidenceStepKey, HomologacaoEvidenceCopy } from './types';

/**
 * The PRODUCTION evidence packs (FUT-4198) — the sandbox packs with every
 * sentence that would describe a production run in sandbox words replaced.
 * Production charges real cards R$ 1,00 per scenario and refunds each one, so
 * the file says so, and never mentions a simulator or a test card.
 */

type Steps = HomologacaoEvidenceCopy['steps'];

function withSteps(base: Steps, overrides: Partial<Record<EvidenceStepKey, { scenario: string; expected: string }>>): Steps {
  return { ...base, ...overrides } as Steps;
}

const PT = PT_BR_HOMOLOGACAO_EVIDENCE_COPY;

export const PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY: HomologacaoEvidenceCopy = {
  ...PT,
  title: 'EVIDÊNCIAS DE HOMOLOGAÇÃO — PAGBANK (API CONNECT E API DE PEDIDOS/ORDERS, PIX E CARTÃO) — PRODUÇÃO',
  steps: withSteps(PT.steps, {
    'connect.authorize': {
      scenario: 'Autorização da conta do lojista (login e consentimento no PagBank)',
      expected: 'O lojista faz login na produção do PagBank, aprova o consentimento e é redirecionado ao callback com code e state.',
    },
    'pix.paid': {
      scenario: 'Confirmação de pagamento Pix em produção',
      expected: 'Uma pessoa paga o QR Code de R$ 1,00 pelo app do banco; a consulta retorna a cobrança com status PAID.',
    },
    'card.encrypt': {
      scenario: 'Preparação dos dados do cartão — criptografia no navegador (PagSeguro.encryptCard)',
      expected: 'O cartão real digitado pelo operador é criptografado no navegador com a chave pública do lojista; apenas o valor criptografado chega ao servidor.',
    },
    'card.declined': {
      scenario: 'Pedido com cartão de crédito recusado — POST /orders',
      expected: 'Não executado em produção: a recusa está coberta no arquivo de sandbox.',
    },
    'debit.authenticate': {
      scenario: 'Autenticação 3DS do cartão de débito real',
      expected: 'O SDK do PagBank (PagSeguro.authenticate3DS) autentica no navegador o cartão de débito criptografado, no valor de R$ 1,00, com o desafio do banco quando ele pedir: status AUTH_FLOW_COMPLETED, AUTHENTICATED, com o id da autenticação.',
    },
    'gpay.token': {
      scenario: 'Token do Google Pay obtido no navegador (ambiente PRODUCTION do Google, gateway pagbank)',
      expected:
        'O operador abre a folha do Google Pay (PaymentsClient em PRODUCTION; tokenizationSpecification PAYMENT_GATEWAY com gateway pagbank e ' +
        'gatewayMerchantId = conta PagBank do lojista), no valor de R$ 1,00, e escolhe um cartão real; o navegador recebe ' +
        'paymentMethodData.tokenizationData.token. Nenhuma requisição da integração ao PagBank neste passo.',
    },
    'apay.token': {
      scenario: 'Token do Apple Pay obtido no navegador (ApplePaySession com validação do comerciante)',
      expected:
        'O operador abre a folha do Apple Pay no Safari (ApplePaySession versão 3, Visa e Mastercard), no valor de R$ 1,00; a integração ' +
        'valida o comerciante no servidor com a identidade Apple Pay da plataforma e o navegador recebe token.paymentData. Nenhuma ' +
        'requisição da integração ao PagBank neste passo.',
    },
  }),
  redactionNote:
    'Segurança: Authorization, access_token, refresh_token, client_secret, códigos OAuth, cookies, ' +
    'CVV, número completo e dados criptografados do cartão e o token das carteiras digitais (Google Pay e ' +
    'Apple Pay, card.wallet.key) foram removidos e aparecem como ***REDACTED***; CPF/CNPJ e telefone do ' +
    'titular aparecem mascarados. Todas as chamadas abaixo foram registradas pelo próprio código da ' +
    'integração no momento em que foram feitas; nenhuma resposta foi escrita à mão. Os pedidos são reais, ' +
    'em produção, de R$ 1,00 cada, e foram estornados logo depois.',
  pendencies: {
    ...PT.pendencies,
    notCovered: [
      'Não executado em produção: cartão recusado (coberto no arquivo de sandbox).',
      'Não testado: parcelamento (os pedidos usam 1 parcela).',
      'Não aplicável: captura posterior (pré-autorização). A integração autoriza e captura na mesma chamada (capture: true).',
      'Não testado: boleto.',
      'Notificações recusadas na verificação de assinatura não são armazenadas. Uma notificação ausente pode não ter sido enviada ou ter sido recusada.',
    ],
  },
  outcome: {
    ...PT.outcome,
    usageNotConnected: 'Nenhum lojista conectado em produção; conecte-o antes de gerar as evidências.',
    notSandbox: 'A conexão do lojista não é de produção; nada foi executado.',
  },
};

const EN = EN_US_HOMOLOGACAO_EVIDENCE_COPY;

export const EN_US_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY: HomologacaoEvidenceCopy = {
  ...EN,
  title: 'HOMOLOGATION EVIDENCE — PAGBANK (CONNECT API AND ORDERS API, PIX AND CARD) — PRODUCTION',
  steps: withSteps(EN.steps, {
    'connect.authorize': {
      scenario: "Authorization of the seller's account (login and consent at PagBank)",
      expected: "The seller logs in to PagBank's production, approves the consent and is redirected to the callback with code and state.",
    },
    'pix.paid': {
      scenario: 'Pix payment confirmation in production',
      expected: "A person pays the R$ 1.00 QR code from their bank's app; the consult returns the charge with status PAID.",
    },
    'card.encrypt': {
      scenario: 'Card data preparation — encryption in the browser (PagSeguro.encryptCard)',
      expected: "The real card the operator typed is encrypted in the browser with the seller's public key; only the encrypted value reaches the server.",
    },
    'card.declined': {
      scenario: 'Declined credit card order — POST /orders',
      expected: 'Not run in production: the decline is covered by the sandbox file.',
    },
    'debit.authenticate': {
      scenario: '3DS authentication of the real debit card',
      expected: "PagBank's SDK (PagSeguro.authenticate3DS) authenticates the encrypted debit card in the browser for R$ 1.00, with the bank's challenge when it asks for one: status AUTH_FLOW_COMPLETED, AUTHENTICATED, with the authentication id.",
    },
    'gpay.token': {
      scenario: "Google Pay token obtained in the browser (Google's PRODUCTION environment, gateway pagbank)",
      expected:
        "The operator opens Google Pay's sheet (PaymentsClient in PRODUCTION; tokenizationSpecification PAYMENT_GATEWAY with gateway pagbank and " +
        "gatewayMerchantId = the seller's PagBank account), for R$ 1.00, and picks a real card; the browser receives " +
        'paymentMethodData.tokenizationData.token. No request from the integration to PagBank in this step.',
    },
    'apay.token': {
      scenario: 'Apple Pay token obtained in the browser (ApplePaySession with merchant validation)',
      expected:
        "The operator opens Apple Pay's sheet in Safari (ApplePaySession version 3, Visa and Mastercard), for R$ 1.00; the integration " +
        "validates the merchant server-side with the platform's Apple Pay identity and the browser receives token.paymentData. No " +
        'request from the integration to PagBank in this step.',
    },
  }),
  redactionNote:
    'Security: Authorization, access_token, refresh_token, client_secret, OAuth codes, cookies, ' +
    "CVV, the card's full number and encrypted data, and the digital wallets' token (Google Pay and " +
    "Apple Pay, card.wallet.key) were removed and show as ***REDACTED***; the cardholder's CPF/CNPJ and " +
    "phone are masked. Every call below was recorded by the integration's own code as it was made; no " +
    'response was written by hand. The orders are real, in production, R$ 1.00 each, and were refunded right after.',
  pendencies: {
    ...EN.pendencies,
    notCovered: [
      'Not run in production: declined card (covered by the sandbox file).',
      'Not tested: installments (the orders use 1 installment).',
      'Not applicable: later capture (pre-authorization). The integration authorizes and captures in the same call (capture: true).',
      'Not tested: boleto.',
      'Notifications refused at signature verification are not stored. A missing notification may not have been sent, or may have been refused.',
    ],
  },
  outcome: {
    ...EN.outcome,
    usageNotConnected: 'No seller connected in production; connect it before generating the evidence.',
    notSandbox: "The seller's connection is not a production one; nothing was run.",
  },
};
