/**
 * FUT-590 — the payer document field's reading, as properties rather than
 * rows (the rows the reviews tried are the shared corpus,
 * `components/checkout/__tests__/tax-id-paste-corpus.ts`).
 *
 * Before FUT-590 the field kept DIGITS ONLY, capped at fourteen ("OLD"), and
 * that alone dropped every label, name, phone, mark and space. A paste now
 * differs from OLD only where an alphanumeric CNPJ is clearly there, so:
 *
 *  (A) the field never invents a valid document: a valid output is OLD, or
 *      the characters of one whole token of the paste;
 *  (B) whenever OLD is a valid document, the output is OLD;
 *  (C) a valid alphanumeric CNPJ, masked or not, labelled or not, comes back;
 *  (D) any document typed key by key into the masked field ends as itself.
 *
 * The randomness is a seeded generator, so a failure names a case that
 * reproduces.
 */
import { describe, expect, it } from 'vitest';

import { formatCpfOrCnpj, isValidCpfOrCnpj, taxIdInput } from './tax-id';

const DIGITS = '0123456789';
const ALPHANUMERIC = `${DIGITS}ABCDEFGHIJKLMNOPQRSTUVWXYZ`;

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

type Kind = 'cpf' | 'cnpj' | 'alphanumeric';

function validDocument(random: () => number, kind: Kind): string {
  for (;;) {
    const base =
      kind === 'cpf'
        ? characters(random, DIGITS, 9)
        : characters(random, kind === 'cnpj' ? DIGITS : ALPHANUMERIC, 12);
    if (kind === 'alphanumeric' && !/[A-Z]/.test(base)) continue;
    const check = kind === 'cpf' ? cpfCheckDigit : cnpjCheckDigit;
    const first = base + check(base);
    const document = first + check(first);
    if (isValidCpfOrCnpj(document)) return document;
  }
}

/** The document with its last digit changed: a typo, never a valid one. */
function typo(random: () => number, document: string): string {
  for (;;) {
    const changed = document.slice(0, -1) + pick(random, [...DIGITS]);
    if (!isValidCpfOrCnpj(changed)) return changed;
  }
}

function masked(document: string): string {
  return document.length === 11
    ? `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`
    : `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
}

/** The ways a document stays ONE token: plain, masked, lowercase, fullwidth. */
function asOneToken(random: () => number, document: string): string {
  switch (pick(random, ['plain', 'masked', 'lowercase', 'fullwidth'])) {
    case 'plain':
      return document;
    case 'lowercase':
      return masked(document).toLowerCase();
    case 'fullwidth':
      return masked(document).replace(/[0-9/-]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    default:
      return masked(document);
  }
}

/** Any way a document is written, the ones that split it into several tokens included. */
function written(random: () => number, document: string): string {
  const mask = masked(document);
  switch (pick(random, ['one-token', 'spaced', 'spaced-mask', 'look-alike'])) {
    case 'spaced':
      return mask.replace(/[./-]/g, ' ');
    case 'spaced-mask':
      return mask.replace(/[./-]/g, (mark) => ` ${mark} `);
    case 'look-alike':
      return mask.replace(/[./-]/g, (mark) => (mark === '-' ? '‑' : mark === '.' ? pick(random, [',', '·']) : '∕'));
    default:
      return asOneToken(random, document);
  }
}

const LABELS = [
  'CPF ',
  'CPF: ',
  'cpf : ',
  'CPF n.º ',
  'CNPJ: ',
  'CNPJ/MF ',
  'CNPJ nº ',
  'CPF/CNPJ: ',
  'Documento: ',
  'Doc ',
  '*CPF:* ',
  '- CPF: ',
  '• CNPJ: ',
  'CPF do usuário: ',
  'Inscrição: ',
  'Beneficiário: ',
  'CNPJ do MEI: ',
  'CNPJ — ',
];
const MARKS: ReadonlyArray<readonly [string, string]> = [
  ['', ''],
  ['"', '"'],
  ['(', ')'],
  ['[', ']'],
  ['*', '*'],
  ['#', ''],
  ['`', '`'],
  ['_', '_'],
];
const NAMES = ['Fulano de Tal', 'Empresa X LTDA', 'JOÃO DA SILVA ME', 'Açaí & Cia EPP', 'José Ávila', '✅', '(titular)', 'S/A'];

function phone(random: () => number): string {
  const ddd = characters(random, DIGITS, 2);
  return pick(random, [
    `(${ddd}) 9${characters(random, DIGITS, 4)}-${characters(random, DIGITS, 4)}`,
    `${ddd} 9${characters(random, DIGITS, 4)} ${characters(random, DIGITS, 4)}`,
    `Tel: ${ddd} ${characters(random, DIGITS, 4)}-${characters(random, DIGITS, 4)}`,
  ]);
}

function date(random: () => number): string {
  return `${characters(random, '012', 1)}${characters(random, DIGITS, 1)}/${pick(random, ['01', '06', '12'])}/19${characters(random, DIGITS, 2)}`;
}

function context(random: () => number, withDigits: boolean): string {
  const kinds = withDigits ? ['name', 'phone', 'date', 'order'] : ['name'];
  switch (pick(random, kinds)) {
    case 'phone':
      return phone(random);
    case 'date':
      return date(random);
    case 'order':
      return `Pedido #${characters(random, DIGITS, 5)}`;
    default:
      return pick(random, NAMES);
  }
}

/** A paste: some context, a label, a mark, the document, a mark, more context — always with a space. */
function wrapped(random: () => number, document: string, withDigits: boolean): string {
  const before = random() < 0.3 ? `${context(random, withDigits)}${pick(random, [' ', '\n', ' - ', ', '])}` : '';
  const [open, close] = pick(random, MARKS);
  const after = random() < 0.6 ? `${pick(random, [' ', '\n', '\t', ', ', ' - '])}${context(random, withDigits)}` : '';
  return `${before}${pick(random, LABELS)}${open}${document}${close}${after}`;
}

/** The reading every rule starts from, as `card/tax-id.ts` does it. */
function normalised(value: string): string {
  return value.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

/** What the field kept before FUT-590: every digit, capped at fourteen. */
function old(value: string): string {
  return normalised(value).replace(/\D/g, '').slice(0, 14);
}

function wholeTokens(value: string): string[] {
  return (normalised(value).match(/[0-9A-Z./-]+/g) ?? []).map((token) => token.replace(/[./-]/g, ''));
}

/** 2,000 seeded pastes of a CPF, numeric or alphanumeric CNPJ — a typo in three of ten — wrapped. */
function wrappedPastes(): string[] {
  const random = generator(590);
  return Array.from({ length: 2000 }, () => {
    const kind = pick(random, ['cpf', 'cnpj', 'alphanumeric'] as const);
    const valid = validDocument(random, kind);
    const document = random() < 0.3 ? typo(random, valid) : valid;
    return wrapped(random, written(random, document), true);
  });
}

describe('a paste wrapped in labels, marks, names, phones, dates and accents', () => {

  it('(A) never reads a valid document that is not the digits-only reading or a whole token', () => {
    const invented = wrappedPastes().flatMap((pasted) => {
      const kept = taxIdInput(pasted);
      const allowed = kept === old(pasted) || wholeTokens(pasted).includes(kept);
      return isValidCpfOrCnpj(kept) && !allowed ? [`${JSON.stringify(pasted)} -> ${kept}`] : [];
    });
    expect(invented).toEqual([]);
  });

  it('(B) reads exactly the digits-only reading whenever that is a valid document', () => {
    const lost = wrappedPastes().flatMap((pasted) => {
      const before = old(pasted);
      const kept = taxIdInput(pasted);
      return isValidCpfOrCnpj(before) && kept !== before ? [`${JSON.stringify(pasted)} -> ${kept}, not ${before}`] : [];
    });
    expect(lost).toEqual([]);
  });
});

describe('a valid alphanumeric CNPJ', () => {
  it('(C) comes back exactly, for 300 random ones, masked or not, labelled or not', () => {
    const random = generator(2026);
    const missed = Array.from({ length: 300 }, () => {
      const document = validDocument(random, 'alphanumeric');
      const token = asOneToken(random, document);
      const pasted = random() < 0.5 ? token : wrapped(random, token, false);
      return [pasted, document] as const;
    }).flatMap(([pasted, document]) =>
      taxIdInput(pasted) === document ? [] : [`${JSON.stringify(pasted)} -> ${taxIdInput(pasted)}, not ${document}`],
    );
    expect(missed).toEqual([]);
  });
});

describe('a document typed key by key into the masked field', () => {
  it('(D) ends as itself, for 3000 random CPFs, numeric and alphanumeric CNPJs, masked or not, in both cases', () => {
    const random = generator(4080);
    const wrong: string[] = [];
    for (let at = 0; at < 3000; at += 1) {
      const document = validDocument(random, (['cpf', 'cnpj', 'alphanumeric'] as const)[at % 3] ?? 'cpf');
      for (const keys of [document, masked(document)]) {
        for (const cased of [keys.toUpperCase(), keys.toLowerCase()]) {
          const kept = [...cased].reduce((field, key) => taxIdInput(formatCpfOrCnpj(field) + key), '');
          if (kept !== document) wrong.push(`${JSON.stringify(cased)} -> ${kept}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
