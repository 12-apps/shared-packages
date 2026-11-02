import { PT_BR_HOMOLOGACAO_EVIDENCE_COPY } from './pt-BR';
import { withSteps } from './production-steps';
import type { HomologacaoEvidenceCopy } from './types';

/**
 * The PRODUCTION evidence packs (FUT-4198) — the sandbox packs with every
 * sentence that would describe a production run in sandbox words replaced.
 * Production charges real cards R$ 1,00 per scenario and refunds each one, so
 * the file says so, and never mentions a simulator or a test card.
 */

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

