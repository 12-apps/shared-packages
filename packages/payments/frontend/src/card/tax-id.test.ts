import { describe, expect, it } from 'vitest';

import { PT_BR_CARD_COPY } from './pt-BR';
import { formatCpfOrCnpj, taxIdDigits, validateCpfOrCnpj } from './tax-id';

const fields = PT_BR_CARD_COPY.fields;

describe('the holder document: a CPF or a CNPJ (FUT-4048)', () => {
  it('masks up to 11 digits as a CPF and past them as a CNPJ', () => {
    expect(formatCpfOrCnpj('111444777')).toBe('111.444.777');
    expect(formatCpfOrCnpj('11144477735')).toBe('111.444.777-35');
    expect(formatCpfOrCnpj('112223330001')).toBe('11.222.333/0001');
    expect(formatCpfOrCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('keeps at most a CNPJ’s fourteen digits', () => {
    expect(taxIdDigits('11.222.333/0001-8199')).toBe('11222333000181');
  });

  it('accepts a valid CPF and a valid CNPJ, typed with or without the mask', () => {
    expect(validateCpfOrCnpj('111.444.777-35', fields)).toBeUndefined();
    expect(validateCpfOrCnpj('11.222.333/0001-81', fields)).toBeUndefined();
    expect(validateCpfOrCnpj('11222333000181', fields)).toBeUndefined();
  });

  it('refuses wrong check digits, repeated digits and a length that is neither', () => {
    expect(validateCpfOrCnpj('11222333000182', fields)).toBe('CPF ou CNPJ inválido.');
    expect(validateCpfOrCnpj('11111111111111', fields)).toBe('CPF ou CNPJ inválido.');
    expect(validateCpfOrCnpj('111444777351', fields)).toBe('CPF ou CNPJ inválido.');
  });

  it('asks for the document when nothing was typed', () => {
    expect(validateCpfOrCnpj('', fields)).toBe('Informe o CPF ou o CNPJ.');
  });
});
