/**
 * FUT-590 — the document field takes the alphanumeric CNPJ the Receita issues
 * from July 2026: 12 characters of `0-9`/`A-Z` plus two numeric check digits,
 * masked `AA.AAA.AAA/AAAA-DD`, its letters uppercased. A CPF stays digits only;
 * the numeric CNPJ is unchanged. The check digits are the backend's one
 * validator, so the field cannot take a document the server then refuses.
 */
import { describe, expect, it } from 'vitest';

import { PT_BR_CARD_COPY } from './pt-BR';
import {
  formatCpfOrCnpj,
  isIncompleteCpfOrCnpj,
  isValidCpfOrCnpj,
  plainTaxId,
  taxIdCharacters,
  taxIdKind,
  validateCpfOrCnpj,
} from './tax-id';

const fields = PT_BR_CARD_COPY.fields;

describe('the alphanumeric CNPJ in the payer document field', () => {
  it.each([
    ['12', '12'],
    ['12A', '12.A'],
    ['12abc', '12.ABC'],
    ['12ABC345', '12.ABC.345'],
    ['12ABC34501', '12.ABC.345/01'],
    ['12ABC34501DE', '12.ABC.345/01DE'],
    ['12ABC34501DE3', '12.ABC.345/01DE-3'],
    ['12ABC34501DE35', '12.ABC.345/01DE-35'],
    ['12.abc.345/01de-35', '12.ABC.345/01DE-35'],
  ])('masks %j as a CNPJ the moment it carries a letter: %j', (typed, shown) => {
    expect(formatCpfOrCnpj(typed)).toBe(shown);
  });

  it('keeps the letters, uppercased, and drops only the punctuation', () => {
    expect(taxIdCharacters('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(plainTaxId('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
  });

  it("validates the Receita's sample and refuses wrong check digits", () => {
    expect(isValidCpfOrCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(validateCpfOrCnpj('12.ABC.345/01DE-35', fields)).toBeUndefined();
    expect(taxIdKind('12ABC34501DE35')).toBe('CNPJ');
    expect(isValidCpfOrCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(validateCpfOrCnpj('12.ABC.345/01DE-36', fields)).toBe(fields.taxIdInvalid);
  });

  it('reads eleven characters with a letter as a CNPJ on its way, not a CPF', () => {
    expect(taxIdKind('12ABC345010')).toBeNull();
    expect(isIncompleteCpfOrCnpj('12ABC345010')).toBe(true);
    expect(isIncompleteCpfOrCnpj('12ABC34501DE35')).toBe(false);
  });

  it('leaves the CPF and the numeric CNPJ as they were', () => {
    expect(formatCpfOrCnpj('52998224725')).toBe('529.982.247-25');
    expect(formatCpfOrCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(taxIdKind('52998224725')).toBe('CPF');
    expect(isValidCpfOrCnpj('11.222.333/0001-81')).toBe(true);
  });
});
