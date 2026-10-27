import { describe, expect, it } from 'vitest';

import { EN_US_CARD_COPY } from './en-US';
import { PT_BR_CARD_COPY } from './pt-BR';
import {
  formatCpfOrCnpj,
  isIncompleteCpfOrCnpj,
  isValidCpfOrCnpj,
  plainTaxId,
  taxIdDigits,
  taxIdKind,
  validateCpfOrCnpj,
} from './tax-id';

const fields = PT_BR_CARD_COPY.fields;

const VALID_CPFS = ['529.982.247-25', '111.444.777-35', '123.456.789-09', '935.411.347-80'];
const VALID_CNPJS = [
  '11.222.333/0001-81',
  '11.444.777/0001-61',
  '00.000.000/0001-91',
  '33.000.167/0001-01',
  '60.701.190/0001-04',
];

describe('the payer document mask: a CPF up to 11 digits, a CNPJ from the 12th (FUT-4048, FUT-4080)', () => {
  it.each([
    ['', ''],
    ['1', '1'],
    ['111', '111'],
    ['1114', '111.4'],
    ['111444', '111.444'],
    ['1114447', '111.444.7'],
    ['111444777', '111.444.777'],
    ['1114447773', '111.444.777-3'],
    ['11144477735', '111.444.777-35'],
  ])('masks %j as a CPF while it is one: %j', (typed, shown) => {
    expect(formatCpfOrCnpj(typed)).toBe(shown);
  });

  it.each([
    ['112223330001', '11.222.333/0001'],
    ['1122233300018', '11.222.333/0001-8'],
    ['11222333000181', '11.222.333/0001-81'],
  ])('switches to the CNPJ mask from the 12th digit: %j → %j', (typed, shown) => {
    expect(formatCpfOrCnpj(typed)).toBe(shown);
  });

  it('re-masks a CPF that grows into a CNPJ, and back when a digit is deleted', () => {
    const cpfShaped = formatCpfOrCnpj('11222333000');
    expect(cpfShaped).toBe('112.223.330-00');
    const cnpjShaped = formatCpfOrCnpj(`${cpfShaped}1`);
    expect(cnpjShaped).toBe('11.222.333/0001');
    expect(formatCpfOrCnpj(cnpjShaped.slice(0, -1))).toBe('112.223.330-00');
  });

  it.each([
    ['11.222.333/0001-81', '11.222.333/0001-81'],
    ['11222333000181', '11.222.333/0001-81'],
    [' 11 222 333 0001 81 ', '11.222.333/0001-81'],
    ['529.982.247-25', '529.982.247-25'],
    ['52998224725', '529.982.247-25'],
    ['529 982 247 25', '529.982.247-25'],
  ])('takes a paste with or without punctuation: %j → %j', (pasted, shown) => {
    expect(formatCpfOrCnpj(pasted)).toBe(shown);
  });

  it('keeps at most a CNPJ’s fourteen digits, whatever is pasted after them', () => {
    expect(taxIdDigits('11.222.333/0001-8199')).toBe('11222333000181');
    expect(formatCpfOrCnpj('112223330001819999')).toBe('11.222.333/0001-81');
  });

  it('drops letters: the alphanumeric CNPJ is not accepted yet', () => {
    expect(taxIdDigits('12.ABC.345/01DE-35')).toBe('123450135');
  });
});

describe('the payer document check: a CPF’s or a CNPJ’s own check digits', () => {
  it.each(VALID_CPFS)('accepts the valid CPF %s, masked or not', (cpf) => {
    expect(isValidCpfOrCnpj(cpf)).toBe(true);
    expect(isValidCpfOrCnpj(cpf.replace(/\D/g, ''))).toBe(true);
    expect(validateCpfOrCnpj(cpf, fields)).toBeUndefined();
  });

  it.each(VALID_CNPJS)('accepts the valid CNPJ %s, masked or not', (cnpj) => {
    expect(isValidCpfOrCnpj(cnpj)).toBe(true);
    expect(isValidCpfOrCnpj(cnpj.replace(/\D/g, ''))).toBe(true);
    expect(validateCpfOrCnpj(cnpj, fields)).toBeUndefined();
  });

  it.each([
    ['a CPF with the first check digit wrong', '529.982.247-35'],
    ['a CPF with the second check digit wrong', '529.982.247-26'],
    ['a CNPJ with the first check digit wrong', '11.222.333/0001-91'],
    ['a CNPJ with the second check digit wrong', '11.222.333/0001-82'],
    ['a CNPJ with a swapped body digit', '11.222.333/0010-81'],
  ])('refuses %s', (_case, value) => {
    expect(isValidCpfOrCnpj(value)).toBe(false);
    expect(validateCpfOrCnpj(value, fields)).toBe('Informe um CPF ou CNPJ válido.');
  });

  it.each([...'0123456789'].flatMap((d) => [d.repeat(11), d.repeat(14)]))(
    'refuses the all-same-digit sequence %s',
    (value) => {
      expect(isValidCpfOrCnpj(value)).toBe(false);
    },
  );

  it.each([
    ['10 digits', '5299822472'],
    ['12 digits', '112223330001'],
    ['13 digits', '1122233300018'],
    ['a valid CPF with a stray digit', '529982247251'],
  ])('refuses a length that is neither: %s', (_case, value) => {
    expect(isValidCpfOrCnpj(value)).toBe(false);
    expect(validateCpfOrCnpj(value, fields)).toBe('Informe um CPF ou CNPJ válido.');
  });

  it('asks for the document when nothing, or only punctuation, was typed', () => {
    expect(validateCpfOrCnpj('', fields)).toBe('Informe o CPF ou o CNPJ.');
    expect(validateCpfOrCnpj('../-', fields)).toBe('Informe o CPF ou o CNPJ.');
  });

  it('says the same in en-US, keeping both documents’ names', () => {
    expect(validateCpfOrCnpj('11222333000182', EN_US_CARD_COPY.fields)).toBe('Enter a valid CPF or CNPJ.');
  });
});

describe('a partly typed document', () => {
  it.each([
    ['1', true],
    ['5299822472', true],
    ['52998224725', false],
    ['112223330001', true],
    ['1122233300018', true],
    ['11222333000181', false],
  ])('%s is incomplete: %s', (value, incomplete) => {
    expect(isIncompleteCpfOrCnpj(value)).toBe(incomplete);
  });

  it('reads the kind by its length, and nothing while it is neither', () => {
    expect(taxIdKind('529.982.247-25')).toBe('CPF');
    expect(taxIdKind('11.222.333/0001-81')).toBe('CNPJ');
    expect(taxIdKind('112223330001')).toBeNull();
    expect(taxIdKind(undefined)).toBeNull();
  });
});

describe('the document a charge carries', () => {
  it('is plain digits, whichever mask the buyer state held', () => {
    expect(plainTaxId('11.222.333/0001-81')).toBe('11222333000181');
    expect(plainTaxId('529.982.247-25')).toBe('52998224725');
    expect(plainTaxId('52998224725')).toBe('52998224725');
  });

  it('is absent when there is none', () => {
    expect(plainTaxId(undefined)).toBeUndefined();
    expect(plainTaxId('')).toBeUndefined();
    expect(plainTaxId(' .-/ ')).toBeUndefined();
  });
});
