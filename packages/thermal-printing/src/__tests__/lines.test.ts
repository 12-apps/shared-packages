import { describe, expect, it } from "vitest";

import { columnsFor, field, PAPER_WIDTHS_MM, rule, wrap } from "../index";

/**
 * The fixed-width arithmetic every transport shares.
 *
 * Asserted here rather than on paper, which is the whole reason the line model
 * is a separate step from the two encoders: a fixed-width receipt is
 * arithmetic, and arithmetic that only a printer can check is arithmetic
 * nobody checks.
 */

describe("columnsFor", () => {
  it("gives 32 columns to a 58mm roll and 48 to an 80mm one", () => {
    expect(columnsFor(58)).toBe(32);
    expect(columnsFor(80)).toBe(48);
  });

  it("falls back to the wider roll for a width nothing supports", () => {
    // A narrower guess would silently wrap every line of an unknown printer;
    // the wider one prints inside the paper and stays readable.
    expect(columnsFor(112)).toBe(48);
  });

  it("has a column count for every width it advertises", () => {
    // The exported list and the table are two statements of the same fact, and
    // a width added to one and not the other is the silent kind of wrong.
    for (const width of PAPER_WIDTHS_MM) expect(columnsFor(width)).toBeGreaterThan(0);
  });
});

describe("wrap", () => {
  it("breaks at the column width", () => {
    expect(wrap("um dois tres quatro cinco", 12)).toEqual(["um dois tres", "quatro cinco"]);
  });

  it("indents the continuation so a wrapped item reads as ONE thing", () => {
    // The failure this prevents: a flush-left continuation reads as a second
    // item, which on a kitchen pass is a plate too many.
    expect(wrap("1x Chup Chup Gourmet com Nutella", 20, 3)).toEqual([
      "1x Chup Chup Gourmet",
      "   com Nutella",
    ]);
  });

  it("breaks a word longer than the roll rather than letting it overflow", () => {
    // The printer would wrap it anyway, at a column this code did not choose.
    expect(wrap("AAAAAAAAAA", 4)).toEqual(["AAAA", "AAAA", "AA"]);
  });

  it("never returns a line wider than the roll", () => {
    const long = "Chup Chup Gourmet de Maracuja com Nutella e Leite Ninho Especial";
    for (const columns of [32, 48]) {
      for (const produced of wrap(long, columns, 3)) {
        expect(produced.length).toBeLessThanOrEqual(columns);
      }
    }
  });
});

describe("field", () => {
  it("drops a field with no value rather than printing a bare label", () => {
    expect(field("Address", null, 48)).toEqual([]);
    expect(field("Address", "   ", 48)).toEqual([]);
  });

  it("hangs the continuation under the label, not under the value", () => {
    const lines = field("Endereco", "rua jose cezarino 40 apto 21 bloco b", 24);

    expect(lines.map((entry) => entry.text)).toEqual([
      "Endereco: rua jose",
      "          cezarino 40",
      "          apto 21 bloco",
      "          b",
    ]);
  });
});

describe("rule", () => {
  it("spans exactly the roll", () => {
    expect(rule(32).text).toHaveLength(32);
  });
});
