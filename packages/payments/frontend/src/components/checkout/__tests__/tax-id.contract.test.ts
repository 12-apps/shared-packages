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
