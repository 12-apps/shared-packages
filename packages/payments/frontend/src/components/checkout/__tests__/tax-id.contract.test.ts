/**
 * The document field and the server read a CPF or CNPJ THE SAME WAY (FUT-590).
 *
 * The browser rule (`card/tax-id.ts`) mirrors `@12-apps/payments-backend`'s,
 * because this package may import only types from there (ADOPTING.md §6). Two
 * copies drift — and here a drift is a buyer whose valid alphanumeric CNPJ the
 * field accepts and the gate refuses, or the reverse. So both run over one
 * table: what they keep, whether it is valid, and which document it is.
 */
import {
  isValidCpfOrCnpj as serverIsValid,
  taxIdCharacters as serverCharacters,
  taxIdKind as serverKind,
} from "@12-apps/payments-backend";
import { describe, expect, it } from "vitest";

import { isValidCpfOrCnpj, taxIdCharacters, taxIdKind } from "../../../card";

const TABLE = [
  // CPF
  "529.982.247-25",
  "52998224725",
  "111.111.111-11",
  "123.456.789-00",
  "1234567890A",
  // numeric CNPJ
  "11.222.333/0001-81",
  "11222333000182",
  "00000000000000",
  // alphanumeric CNPJ — the Receita's sample, PagBrasil's test value, and near misses
  "12.ABC.345/01DE-35",
  "12abc34501de35",
  "AB000000000162",
  "12ABC34501DE36",
  "12ABC34501DE3A",
  "AAAAAAAAAAAAAA",
  // partial and junk
  "",
  "12.ABC",
  "12ABC34501DE",
  " 12 abc 345 01de 35 ",
  "12ABC34501DE35999",
];

describe("the field and the server agree on every document", () => {
  it.each(TABLE)("%j", (value) => {
    expect(taxIdCharacters(value)).toBe(serverCharacters(value));
    expect(isValidCpfOrCnpj(value)).toBe(serverIsValid(value));
    expect(taxIdKind(value)).toBe(serverKind(value));
  });
});

describe("a document longer than fourteen characters", () => {
  it.each(["12ABC34501DE35999", "11222333000181999", "529982247251"])("%j is valid for neither", (value) => {
    expect(isValidCpfOrCnpj(value)).toBe(false);
    expect(serverIsValid(value)).toBe(false);
  });
});

/**
 * Property check over generated documents. The test computes the check digits
 * ITSELF — a third, independent spelling of the Receita's rule — so both
 * copies are held to the rule, not just to each other. Deterministic, so a
 * failure reproduces.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A pure integer mix of `n` (no state to carry), so the n-th draw is always the same. */
function draw(n: number): number {
  const mixed = Math.imul((n + 590) ^ ((n + 590) >>> 15), 2_246_822_519);
  return (Math.imul(mixed ^ (mixed >>> 13), 3_266_489_917) ^ (mixed >>> 16)) >>> 0;
}

function checkDigit(base: string): number {
  const sum = [...base].reverse().reduce((acc, char, i) => acc + (char.charCodeAt(0) - 48) * ((i % 8) + 2), 0);
  return sum % 11 < 2 ? 0 : 11 - (sum % 11);
}

function withCheckDigits(base: string): string {
  const first = checkDigit(base);
  return `${base}${first}${checkDigit(`${base}${first}`)}`;
}

function generated(count: number): string[] {
  return Array.from({ length: count }, (_doc, doc) =>
    withCheckDigits(Array.from({ length: 12 }, (_char, at) => ALPHABET[draw(doc * 12 + at) % ALPHABET.length]).join("")),
  ).filter((cnpj) => !/^(.)\1+$/.test(cnpj));
}

describe("generated CNPJs: both copies agree with the rule, and with each other", () => {
  const CNPJS = generated(300);

  it("accepts every generated CNPJ, masked or not, in either case", () => {
    for (const cnpj of CNPJS) {
      for (const shape of [cnpj, cnpj.toLowerCase(), `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`]) {
        expect(isValidCpfOrCnpj(shape), shape).toBe(true);
        expect(serverIsValid(shape), shape).toBe(true);
        expect(taxIdKind(shape), shape).toBe(serverKind(shape));
      }
    }
  });

  it("refuses each one with a wrong check digit, or one character too many", () => {
    for (const cnpj of CNPJS) {
      const wrong = `${cnpj.slice(0, 13)}${(Number(cnpj[13]) + 1) % 10}`;
      for (const value of [wrong, `${cnpj}0`]) {
        expect(isValidCpfOrCnpj(value), value).toBe(false);
        expect(serverIsValid(value), value).toBe(false);
        expect(taxIdCharacters(value)).toBe(serverCharacters(value));
      }
    }
  });
});
