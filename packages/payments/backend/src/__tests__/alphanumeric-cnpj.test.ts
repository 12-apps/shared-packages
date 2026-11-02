/**
 * FUT-590 — the alphanumeric CNPJ, end to end on the server side.
 *
 * From July 2026 the Receita issues CNPJs whose first 12 characters may be
 * letters (IN RFB nº 2.229/2024). Each character is worth its ASCII code minus
 * 48 in the same mod-11 check digits, the last two stay numeric, and every
 * numeric CNPJ stays valid. `12.ABC.345/01DE-35` is the Receita's own sample.
 *
 *  - The one validator takes both forms; a CPF stays digits only.
 *  - The buyer gate takes an alphanumeric CNPJ wherever the provider documents
 *    a 14-character CNPJ, and refuses it, before anything is sent, where the
 *    provider documents digits only (Stripe's boleto).
 *  - Every adapter sends the letters, uppercased, without punctuation — never
 *    a document cut down to its digits.
 */
import { describe, expect, it } from 'vitest';

import { CustomerRequirementsError } from '../core/errors';
import { validateCustomer } from '../core/customer-schema';
import { isValidCnpj, isValidCpfOrCnpj, taxIdCharacters, taxIdHasLetters, taxIdKind } from '../core/tax-id';
import type { ChargeInput } from '../core/types';
import { devedorOf } from '../providers/itau-pix';
import { customerPayload as pagbankCustomer } from '../providers/pagbank-http';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY, PT_BR_STONE_COPY, PT_BR_STRIPE_COPY } from '../providers/pt-BR';
import { orderPayload as stoneOrder } from '../providers/stone-payload';
import { stoneProvider } from '../providers/stone';
import { intentPayload as stripeIntent } from '../providers/stripe-charges';
import { stripeProvider } from '../providers/stripe';
import { pixInput } from './fixtures';

/** The Receita's sample, and PagBrasil's published test value. */
const SAMPLE = '12.ABC.345/01DE-35';
const SAMPLE_KEPT = '12ABC34501DE35';
const OTHER = 'AB000000000162';
const NUMERIC_CNPJ = '11.222.333/0001-81';
const CPF = '123.456.789-09';

describe('the one tax-id validator', () => {
  it.each([SAMPLE, SAMPLE_KEPT, '12abc34501de35', OTHER, NUMERIC_CNPJ, '11222333000181'])('takes the valid CNPJ %s', (value) => {
    expect(isValidCnpj(value)).toBe(true);
    expect(isValidCpfOrCnpj(value)).toBe(true);
    expect(taxIdKind(value)).toBe('CNPJ');
  });

  it.each([
    ['a wrong first check digit', '12ABC34501DE45'],
    ['a wrong second check digit', '12ABC34501DE36'],
    ['the check digits swapped', '12ABC34501DE53'],
    ['a letter among the check digits', '12ABC34501DE3A'],
    ['one character fourteen times', 'AAAAAAAAAAAAAA'],
    ['the numeric CNPJ off by one', '11222333000182'],
    ['thirteen characters', '12ABC34501DE3'],
  ])('refuses %s', (_case, value) => {
    expect(isValidCnpj(value)).toBe(false);
    expect(isValidCpfOrCnpj(value)).toBe(false);
  });

  it('keeps a CPF digits only', () => {
    expect(isValidCpfOrCnpj(CPF)).toBe(true);
    expect(taxIdKind(CPF)).toBe('CPF');
    // Eleven characters with a letter are not a CPF, whatever their digits are.
    expect(isValidCpfOrCnpj('1234567890A')).toBe(false);
    expect(taxIdKind('1234567890A')).toBeNull();
    expect(isValidCpfOrCnpj('111.111.111-11')).toBe(false);
  });

  it('keeps letters, uppercased, and drops only the punctuation', () => {
    expect(taxIdCharacters('12.abc.345/01de-35')).toBe(SAMPLE_KEPT);
    expect(taxIdCharacters(' 123.456.789-09 ')).toBe('12345678909');
    expect(taxIdHasLetters(SAMPLE)).toBe(true);
    expect(taxIdHasLetters(NUMERIC_CNPJ)).toBe(false);
  });
});

describe('the buyer gate', () => {
  it('takes an alphanumeric CNPJ where the provider documents a 14-character CNPJ', () => {
    for (const schema of [pagbankProvider(PT_BR_PAGBANK_COPY).customerSchema, stoneProvider(PT_BR_STONE_COPY).customerSchema]) {
      expect(validateCustomer(schema, 'PIX', { taxId: SAMPLE })).toEqual([]);
    }
  });

  it("refuses it before anything is sent where the provider documents digits only — Stripe's boleto", () => {
    const schema = stripeProvider(PT_BR_STRIPE_COPY).customerSchema;
    const buyer = { name: 'Loja Nova', email: 'loja@example.com' };
    expect(validateCustomer(schema, 'BOLETO', { ...buyer, taxId: SAMPLE })).toEqual([
      { field: 'taxId', reason: 'INVALID', required: true, detail: 'LETTERS_UNSUPPORTED' },
    ]);
    // The numeric documents still pass.
    expect(validateCustomer(schema, 'BOLETO', { ...buyer, taxId: NUMERIC_CNPJ })).toEqual([]);
    expect(validateCustomer(schema, 'BOLETO', { ...buyer, taxId: CPF })).toEqual([]);
  });
});

function withDocument(taxId: string, base: ChargeInput = pixInput()): ChargeInput {
  return { ...base, customer: { ...base.customer, name: 'Loja Nova', taxId } };
}

describe('what each adapter sends', () => {
  it('PagBank: customer.tax_id carries the letters', () => {
    expect(pagbankCustomer({ taxId: SAMPLE }).tax_id).toBe(SAMPLE_KEPT);
    expect(pagbankCustomer({ taxId: CPF }).tax_id).toBe('12345678909');
  });

  it('Pagar.me (Stone): customer.document carries the letters, as a company', () => {
    const customer = stoneOrder(withDocument(SAMPLE), PT_BR_STONE_COPY).customer as Record<string, unknown>;
    expect(customer).toMatchObject({ document: SAMPLE_KEPT, type: 'company' });
  });

  it("Itaú: the cob's devedor.cnpj carries the letters (BACEN: ^[0-9A-Z]{14}$)", () => {
    expect(devedorOf(withDocument(SAMPLE))).toEqual({ cnpj: SAMPLE_KEPT, nome: 'Loja Nova' });
    expect(devedorOf(withDocument('12abc34501de35'))).toEqual({ cnpj: SAMPLE_KEPT, nome: 'Loja Nova' });
  });

  it('Stripe: a boleto for a numeric document sends it, and an alphanumeric CNPJ is refused, never cut to digits', () => {
    const boleto: ChargeInput = { ...pixInput(), method: 'BOLETO' };
    const sent = stripeIntent(withDocument(NUMERIC_CNPJ, boleto)) as { payment_method_data: { boleto: { tax_id: string } } };
    expect(sent.payment_method_data.boleto.tax_id).toBe('11222333000181');
    expect(() => stripeIntent(withDocument(SAMPLE, boleto))).toThrow(CustomerRequirementsError);
    expect(() => stripeIntent(withDocument(SAMPLE, boleto))).toThrow('taxId (INVALID: LETTERS_UNSUPPORTED)');
  });
});

describe('a document longer than fourteen characters (FUT-590 review)', () => {
  const LONG_NUMERIC = '11222333000181999';
  const LONG_ALPHANUMERIC = '12.ABC.345/01DE-35999';

  it('is no valid document, and keeps its length rather than being cut to fourteen', () => {
    expect(taxIdCharacters(LONG_ALPHANUMERIC)).toBe('12ABC34501DE35999');
    for (const value of [LONG_NUMERIC, LONG_ALPHANUMERIC, '529982247251']) {
      expect(isValidCpfOrCnpj(value), value).toBe(false);
      expect(isValidCnpj(value), value).toBe(false);
      expect(taxIdKind(value), value).toBeNull();
    }
  });

  it('is refused by the buyer gate', () => {
    const schema = pagbankProvider(PT_BR_PAGBANK_COPY).customerSchema;
    expect(validateCustomer(schema, 'PIX', { taxId: LONG_NUMERIC })).toEqual([{ field: 'taxId', reason: 'INVALID', required: true }]);
  });

  it('is refused by the adapters that require it, and left out by those that do not — never sent cut down', () => {
    expect(() => pagbankCustomer({ taxId: LONG_NUMERIC })).toThrow(CustomerRequirementsError);
    const stone = stoneOrder(withDocument(LONG_NUMERIC), PT_BR_STONE_COPY).customer as Record<string, unknown>;
    expect(stone.document).toBeUndefined();
    expect(devedorOf(withDocument(LONG_ALPHANUMERIC))).toBeUndefined();
    const boleto: ChargeInput = { ...pixInput(), method: 'BOLETO' };
    expect(() => stripeIntent(withDocument(LONG_NUMERIC, boleto))).toThrow(CustomerRequirementsError);
  });
});
