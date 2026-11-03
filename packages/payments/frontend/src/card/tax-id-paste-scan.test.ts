/**
 * FUT-590 — the paste scan of the payer document field, as properties rather
 * than rows: whatever a receipt, a statement or a chat wraps around a valid
 * CPF or alphanumeric CNPJ, the document comes back; and a 14-digit CNPJ typo,
 * however its digits are split into groups, never comes back as the valid CPF
 * its first eleven digits may be. The rows the reviews tried are the shared
 * corpus (`components/checkout/__tests__/tax-id-paste-corpus.ts`).
 *
 * The randomness is a seeded generator, so a failure names a case that
 * reproduces.
 */
import { describe, expect, it } from 'vitest';

import { isValidCpf } from './cpf';
import { isValidCpfOrCnpj, taxIdInput } from './tax-id';

const CASES = 300;
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Mulberry32: a small seeded generator, the same sequence on every run. */
function generator(seed: number): () => number {
  const states = [seed >>> 0];
  return () => {
    const state = ((states.at(-1) ?? 0) + 0x6d2b79f5) >>> 0;
    states.push(state);
    const a = Math.imul(state ^ (state >>> 15), state | 1);
    const b = a ^ (a + Math.imul(a ^ (a >>> 7), a | 61));
    return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function characters(random: () => number, alphabet: string, length: number): string {
  return Array.from({ length }, () => pick(random, [...alphabet])).join('');
}

function cpfCheckDigit(base: string): string {
  const sum = [...base].reduce((total, digit, i) => total + Number(digit) * (base.length + 1 - i), 0);
  const mod = (sum * 10) % 11;
  return String(mod === 10 ? 0 : mod);
}

function cnpjCheckDigit(base: string): string {
  const sum = [...base]
    .reverse()
    .reduce((total, character, i) => total + (character.charCodeAt(0) - 48) * ((i % 8) + 2), 0);
  const remainder = sum % 11;
  return String(remainder < 2 ? 0 : 11 - remainder);
}

function validCpf(random: () => number): string {
  for (;;) {
    let cpf = characters(random, '0123456789', 9);
    cpf += cpfCheckDigit(cpf);
    cpf += cpfCheckDigit(cpf);
    if (isValidCpf(cpf)) return cpf;
  }
}

function validCnpj(random: () => number): string {
  for (;;) {
    let cnpj = characters(random, ALPHANUMERIC, 12);
    cnpj += cnpjCheckDigit(cnpj);
    cnpj += cnpjCheckDigit(cnpj);
    if (isValidCpfOrCnpj(cnpj)) return cnpj;
  }
}

/** The ways a document is written: masked, plain, spaced, with look-alikes, fullwidth, lowercase. */
function written(random: () => number, document: string): string {
  const parts =
    document.length === 11
      ? [document.slice(0, 3), document.slice(3, 6), document.slice(6, 9), document.slice(9)]
      : [document.slice(0, 2), document.slice(2, 5), document.slice(5, 8), document.slice(8, 12), document.slice(12)];
  const joins =
    document.length === 11 ? ['.', '.', '-'] : ['.', '.', '/', '-'];
  const style = pick(random, ['masked', 'plain', 'spaced', 'look-alike', 'spaced-mask', 'fullwidth', 'lowercase']);
  const join = (between: (mark: string) => string): string =>
    parts.map((part, at) => (at === 0 ? part : `${between(joins[at - 1] ?? '.')}${part}`)).join('');
  switch (style) {
    case 'plain':
      return document;
    case 'spaced':
      return join(() => ' ');
    case 'look-alike':
      return join((mark) => (mark === '-' ? '‑' : mark === '.' ? pick(random, [',', '·']) : '∕'));
    case 'spaced-mask':
      return join((mark) => ` ${mark} `);
    case 'fullwidth':
      return join((mark) => mark).replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
    case 'lowercase':
      return join((mark) => mark).toLowerCase();
    default:
      return join((mark) => mark);
  }
}

const LABELS = [
  '',
  '  ',
  'CPF ',
  'CPF: ',
  'cpf : ',
  'CPF.: ',
  'CPF n.º ',
  'CNPJ: ',
  'CNPJ/MF ',
  'CNPJ/MF: ',
  'CNPJ nº ',
  'CNPJ No. ',
  'CPF/CNPJ: ',
  'Documento: ',
  'Doc: ',
  '*CPF:* ',
  '- CPF: ',
  '• CNPJ: ',
  'CPF do pagador: ',
  'CNPJ do emitente ',
  'CPF (titular): ',
  'Chave PIX CPF ',
  'Beneficiário: Empresa X LTDA - CNPJ: ',
  'Sacado: Fulano CPF ',
  'CNPJ — ',
];
const MARKS: ReadonlyArray<readonly [string, string]> = [
  ['', ''],
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['[', ']'],
  ['*', ''],
  ['#', ''],
  ['`', '`'],
  ['_', '_'],
];
const TRAILERS = ['', ' ', ' Fulano de Tal', ' - Empresa X LTDA', ', nascido em 1990', ' (matriz)', '\tFulano', ' ✅'];

describe('a valid document wrapped in whatever a paste carries', () => {
  it(`comes back, for ${CASES} random CPFs and ${CASES} random alphanumeric CNPJs`, () => {
    const random = generator(590);
    const missed: string[] = [];
    for (let at = 0; at < CASES * 2; at += 1) {
      const document = at % 2 === 0 ? validCpf(random) : validCnpj(random);
      const [open, close] = pick(random, MARKS);
      const pasted = `${pick(random, LABELS)}${open}${written(random, document)}${close}${pick(random, TRAILERS)}`;
      if (taxIdInput(pasted) !== document) missed.push(`${JSON.stringify(pasted)} -> ${taxIdInput(pasted)}`);
    }
    expect(missed).toEqual([]);
  });
});

describe('a 14-digit CNPJ typo split at random group points', () => {
  it(`is never read as a valid CPF, for ${CASES} random typos`, () => {
    const random = generator(4080);
    const wrong: string[] = [];
    for (let at = 0; at < CASES; at += 1) {
      let typo = characters(random, '0123456789', 14);
      while (isValidCpfOrCnpj(typo)) typo = characters(random, '0123456789', 14);
      const cuts = [...new Set(Array.from({ length: 1 + Math.floor(random() * 5) }, () => 1 + Math.floor(random() * 13)))].sort(
        (a, b) => a - b,
      );
      const split = [0, ...cuts, 14]
        .slice(1)
        .map((end, index, ends) => typo.slice(index === 0 ? 0 : (ends[index - 1] ?? 0), end))
        .join(pick(random, [' ', '.', ' . ', '/', ' - ']));
      const pasted = `${pick(random, LABELS)}${split}${pick(random, ['', ' Empresa X', ' Fulano'])}`;
      const kept = taxIdInput(pasted);
      if (isValidCpf(kept) || kept !== typo) wrong.push(`${JSON.stringify(pasted)} -> ${kept}`);
    }
    expect(wrong).toEqual([]);
  });
});
