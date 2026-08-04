import { describe, expect, it } from 'vitest';

import {
  cep,
  CEP_PATTERN,
  cepDigits,
  cnpj,
  cnpjChars,
  formatCep,
  formatCnpj,
  isUf,
  isValidCep,
  isValidCnpj,
  UF_LIST,
} from './br';

/**
 * `11.222.333/0001-81` is the canonical all-numeric fixture; `12.ABC.345/01DE-35`
 * is Receita Federal's own alphanumeric example (IN 2.229/2024).
 */
const VALID_NUMERIC = '11.222.333/0001-81';
const VALID_ALPHANUMERIC = '12.ABC.345/01DE-35';

describe('forms-core/br', () => {
  describe('UF_LIST / isUf', () => {
    it('holds the 27 federative units', () => {
      expect(UF_LIST).toHaveLength(27);
      expect(new Set(UF_LIST).size).toBe(27);
    });

    it('accepts a real UF and rejects anything else', () => {
      expect(isUf('SP')).toBe(true);
      expect(isUf('sp')).toBe(false);
      expect(isUf('XX')).toBe(false);
    });
  });

  describe('cepDigits', () => {
    it('keeps only digits, capped at eight', () => {
      expect(cepDigits('01310-100')).toBe('01310100');
      expect(cepDigits('01310100999')).toBe('01310100');
      expect(cepDigits('abc')).toBe('');
    });
  });

  describe('formatCep', () => {
    it('inserts the hyphen once the sixth digit arrives', () => {
      expect(formatCep('01310')).toBe('01310');
      expect(formatCep('013101')).toBe('01310-1');
      expect(formatCep('01310100')).toBe('01310-100');
    });

    it('is idempotent and forgiving of messy input', () => {
      expect(formatCep(formatCep('01310100'))).toBe('01310-100');
      expect(formatCep('01.310-100')).toBe('01310-100');
    });

    it('produces a value matching CEP_PATTERN once complete', () => {
      expect(CEP_PATTERN.test(formatCep('01310100'))).toBe(true);
    });
  });

  describe('isValidCep', () => {
    it('accepts a complete CEP in either shape', () => {
      expect(isValidCep('01310100')).toBe(true);
      expect(isValidCep('01310-100')).toBe(true);
    });

    it('rejects an incomplete or oversized CEP', () => {
      expect(isValidCep('0131010')).toBe(false);
      expect(isValidCep('')).toBe(false);
    });
  });

  describe('cep validator', () => {
    it('treats empty as valid (the field is optional)', () => {
      expect(cep()('')).toBeUndefined();
      expect(cep()('   ')).toBeUndefined();
    });

    it('returns a message for a malformed CEP', () => {
      expect(cep()('123')).toBeTruthy();
      expect(cep('Informe o CEP')('123')).toBe('Informe o CEP');
    });

    it('returns undefined for a well-formed CEP', () => {
      expect(cep()('01310-100')).toBeUndefined();
    });
  });

  describe('cnpjChars', () => {
    it('strips punctuation, uppercases and keeps letters', () => {
      expect(cnpjChars(VALID_NUMERIC)).toBe('11222333000181');
      expect(cnpjChars('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    });

    it('caps at fourteen characters', () => {
      expect(cnpjChars('11222333000181999')).toHaveLength(14);
    });
  });

  describe('formatCnpj', () => {
    it('masks progressively as characters arrive', () => {
      expect(formatCnpj('11')).toBe('11');
      expect(formatCnpj('11222')).toBe('11.222');
      expect(formatCnpj('11222333')).toBe('11.222.333');
      expect(formatCnpj('112223330001')).toBe('11.222.333/0001');
      expect(formatCnpj('11222333000181')).toBe(VALID_NUMERIC);
    });

    it('masks an alphanumeric CNPJ', () => {
      expect(formatCnpj('12ABC34501DE35')).toBe(VALID_ALPHANUMERIC);
      expect(formatCnpj('12abc34501de35')).toBe(VALID_ALPHANUMERIC);
    });

    it('is idempotent', () => {
      expect(formatCnpj(VALID_NUMERIC)).toBe(VALID_NUMERIC);
      expect(formatCnpj(VALID_ALPHANUMERIC)).toBe(VALID_ALPHANUMERIC);
    });

    it('never lets a letter into the check-digit positions', () => {
      expect(formatCnpj('12ABC34501DEXY')).toBe('12.ABC.345/01DE-');
    });
  });

  describe('isValidCnpj', () => {
    it('accepts an all-numeric CNPJ, masked or bare', () => {
      expect(isValidCnpj(VALID_NUMERIC)).toBe(true);
      expect(isValidCnpj('11222333000181')).toBe(true);
    });

    it("accepts Receita Federal's alphanumeric example", () => {
      expect(isValidCnpj(VALID_ALPHANUMERIC)).toBe(true);
      expect(isValidCnpj('12abc34501de35')).toBe(true);
    });

    it('rejects a wrong check digit', () => {
      expect(isValidCnpj('11222333000182')).toBe(false);
      expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    });

    it('rejects a repeated-character sequence', () => {
      expect(isValidCnpj('00000000000000')).toBe(false);
      expect(isValidCnpj('11111111111111')).toBe(false);
    });

    it('rejects the wrong length', () => {
      expect(isValidCnpj('')).toBe(false);
      expect(isValidCnpj('1122233300018')).toBe(false);
    });

    it('rejects letters in the check-digit positions', () => {
      expect(isValidCnpj('12ABC34501DEAB')).toBe(false);
    });
  });

  describe('cnpj validator', () => {
    it('treats empty as valid (the field is optional)', () => {
      expect(cnpj()('')).toBeUndefined();
      expect(cnpj()('   ')).toBeUndefined();
    });

    it('returns a message for an invalid CNPJ', () => {
      expect(cnpj()('11222333000182')).toBeTruthy();
      expect(cnpj('Confira o CNPJ')('123')).toBe('Confira o CNPJ');
    });

    it('returns undefined for a valid CNPJ', () => {
      expect(cnpj()(VALID_NUMERIC)).toBeUndefined();
      expect(cnpj()(VALID_ALPHANUMERIC)).toBeUndefined();
    });
  });
});
