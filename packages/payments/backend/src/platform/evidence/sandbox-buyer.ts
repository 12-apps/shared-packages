/**
 * PagBank's own sandbox test data for the homologação evidence (FUT-3696,
 * FUT-3755). Browser-safe on purpose: the server raises the orders with it and
 * the super-admin browser authenticates the debit card with it, and the 3DS
 * amount the browser authenticates must be the amount the server charges.
 *
 * Test data only, and the file says so: the evidence may never carry a real
 * person.
 */

/** PagBank's sandbox example buyer. */
export const PAGBANK_SANDBOX_TEST_BUYER = {
  name: 'Jose da Silva',
  email: 'cliente@sandbox.pagseguro.com.br',
  taxId: '12345678909',
} as const;

/**
 * What PagBank's `authenticate3DS` asks of the buyer beyond the order's
 * customer: a MOBILE phone and the billing address (PagBank's documented
 * sandbox example address).
 */
const PAGBANK_SANDBOX_3DS_CONTACT = {
  phone: '+55 11 99999-9999',
  billingAddress: {
    street: 'Avenida Brigadeiro Faria Lima',
    number: '1384',
    complement: 'apto 12',
    regionCode: 'SP',
    city: 'Sao Paulo',
    postalCode: '01452002',
  },
} as const;

/**
 * The debit order's amount, in cents. PagBank's sandbox 3DS test cards answer
 * by AMOUNT: Visa 4000 0000 0000 2701 authenticated for R$ 27,01 is PAID and
 * AUTHENTICATED with no challenge — which is what lets the run go unattended.
 */
const PAGBANK_SANDBOX_DEBIT_CENTS = 2701;

/**
 * The wallet orders' amount, in cents (FUT-3755): Google Pay's and Apple Pay's
 * sheets show it and the server raises the wallet orders for it, so the
 * browser is handed it rather than restating it.
 */
const PAGBANK_SANDBOX_WALLET_CENTS = 1200;

/**
 * The amount each order of a run charges, in cents. Sandbox picks the amounts
 * its simulator answers to (Pix ≤ R$ 100,00, the 3DS card by amount); in
 * PRODUCTION every scenario charges R$ 1,00 of real money and is refunded
 * right after (FUT-4198).
 */
export interface EvidenceAmounts {
  pix: number;
  card: number;
  debit: number;
  wallet: number;
}

const SANDBOX_AMOUNTS: EvidenceAmounts = {
  pix: 1000,
  card: 1500,
  debit: PAGBANK_SANDBOX_DEBIT_CENTS,
  wallet: PAGBANK_SANDBOX_WALLET_CENTS,
};

/** R$ 1,00 everywhere: the smallest real charge, refunded by the run itself. */
const PRODUCTION_AMOUNTS: EvidenceAmounts = { pix: 100, card: 100, debit: 100, wallet: 100 };

export function evidenceAmounts(environment: 'SANDBOX' | 'PRODUCTION'): EvidenceAmounts {
  return environment === 'PRODUCTION' ? PRODUCTION_AMOUNTS : SANDBOX_AMOUNTS;
}

/**
 * What the browser authenticates the debit test card with — handed over by
 * phase 1 rather than restated in the frontend, so the amount the browser
 * authenticates is, by construction, the amount the server charges.
 */
export interface DebitTestData {
  amountCents: number;
  customer: { name: string; email: string; phone: string };
  billingAddress: {
    street: string;
    number: string;
    complement?: string;
    regionCode: string;
    city: string;
    postalCode: string;
  };
}

/** The production debit authentication (FUT-4198): the operator's own cardholder, R$ 1,00. */
export function productionDebitTest(buyer: {
  name: string;
  email: string;
  phone: string;
  billingAddress: DebitTestData['billingAddress'];
}): DebitTestData {
  return {
    amountCents: evidenceAmounts('PRODUCTION').debit,
    customer: { name: buyer.name, email: buyer.email, phone: buyer.phone },
    billingAddress: buyer.billingAddress,
  };
}

export const PAGBANK_SANDBOX_DEBIT_TEST: DebitTestData = {
  amountCents: PAGBANK_SANDBOX_DEBIT_CENTS,
  customer: {
    name: PAGBANK_SANDBOX_TEST_BUYER.name,
    email: PAGBANK_SANDBOX_TEST_BUYER.email,
    phone: PAGBANK_SANDBOX_3DS_CONTACT.phone,
  },
  billingAddress: PAGBANK_SANDBOX_3DS_CONTACT.billingAddress,
};
