import { EN_US_HOMOLOGACAO_EVIDENCE_COPY } from './en-US';
import { withSteps } from './production-steps';
import type { HomologacaoEvidenceCopy } from './types';

/** The en-US translation of `PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY` (FUT-4198). */

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
