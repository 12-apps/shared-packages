/**
 * Measuring Helvetica, and fitting a caller's string to a sticker.
 *
 * The bug this exists for is invisible on screen and expensive on paper: a
 * subproduct URL is two UUIDs, and at a point size derived from the sticker's
 * HEIGHT it ran off a 50 mm sticker and across the crop marks. Nothing in the
 * PDF is wrong — the operators are well-formed, the boxes are declared, the
 * code scans — so every structural assertion the sticker suite makes still
 * passed. It is discovered by looking at the artwork, or at the gráfica.
 *
 * So the properties here are about WIDTH, which is the thing those assertions
 * cannot see.
 */
import { describe, expect, it } from "vitest";

import { fitLines, helveticaWidth, wrapToWidth } from "../text-width";

/** 50 × 70 mm at 7% padding — the smallest preset, in points. */
const SMALL_STICKER_WIDTH = (50 * 72) / 25.4 - ((50 * 0.07 * 72) / 25.4) * 2;

const SUBPRODUCT_URL =
  "barzedoze.com.br/market/p/3f2a1c88-4b6e-4d21-9a55-7c0e1b2d3f44/9c8b7a66-1d2e-4f30-8b11-2a3c4d5e6f70";

describe("measuring", () => {
  it("charges nothing for nothing", () => {
    expect(helveticaWidth("", 10)).toBe(0);
  });

  it("scales linearly with the point size", () => {
    expect(helveticaWidth("abc", 20)).toBeCloseTo(helveticaWidth("abc", 10) * 2, 6);
  });

  it("knows an `m` is nearly four times an `l`", () => {
    // The measurement a single average character width cannot make, and the
    // reason this table exists rather than a constant: 833 against 222.
    expect(helveticaWidth("m", 10)).toBeCloseTo(8.33, 6);
    expect(helveticaWidth("l", 10)).toBeCloseTo(2.22, 6);
  });

  it("uses the real advance for the characters a URL is made of", () => {
    expect(helveticaWidth("0", 10)).toBeCloseTo(5.56, 6);
    expect(helveticaWidth("/", 10)).toBeCloseTo(2.78, 6);
    expect(helveticaWidth("-", 10)).toBeCloseTo(3.33, 6);
    expect(helveticaWidth(".", 10)).toBeCloseTo(2.78, 6);
  });

  it("over-charges for a character it does not know, never under-charges", () => {
    // Only one direction is safe: over-charging shrinks type that would have
    // fit, under-charging puts it off the edge.
    expect(helveticaWidth("ã", 10)).toBeGreaterThanOrEqual(helveticaWidth("a", 10));
  });
});

describe("laying a string out whole", () => {
  it("leaves one that already fits at its preferred size, on one line", () => {
    const fit = fitLines("Cerveja", 200, 12, 4, 2);
    expect(fit).toMatchObject({ lines: ["Cerveja"], size: 12, whole: true });
  });

  it("wraps before it shrinks", () => {
    // The order is the decision: a name squeezed onto one line goes grey long
    // before it goes narrow enough.
    const name = "Sanduíche de pernil com queijo coalho e vinagrete da casa";
    const fit = fitLines(name, 100, 12, 4, 2);
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.join("")).toBe(name);
  });

  it("keeps every line inside the width, whatever it had to do to get there", () => {
    const name = "Sanduíche de pernil com queijo coalho e vinagrete da casa";
    const fit = fitLines(name, 100, 12, 4, 2);
    for (const line of fit.lines) {
      expect(helveticaWidth(line, fit.size)).toBeLessThanOrEqual(100);
    }
  });

  it("fits a subproduct address on the smallest sticker, whole and legible", () => {
    // The defect this closes: two UUIDs on a 50 mm sticker.
    const fit = fitLines(SUBPRODUCT_URL, SMALL_STICKER_WIDTH, 6, 4, 2);
    expect(fit.whole).toBe(true);
    expect(fit.lines.join("")).toBe(SUBPRODUCT_URL);
    expect(fit.size).toBeGreaterThanOrEqual(4);
    for (const line of fit.lines) {
      expect(helveticaWidth(line, fit.size)).toBeLessThanOrEqual(SMALL_STICKER_WIDTH);
    }
  });

  it("stops at the floor and SAYS it did not fit, rather than going grey", () => {
    // A caller can always hand over a string no sticker can carry. Reporting
    // that is the point: the alternative is discovering it at the gráfica.
    const fit = fitLines("m".repeat(400), 60, 12, 4, 2);
    expect(fit.size).toBe(4);
    expect(fit.whole).toBe(false);
  });
});

describe("wrapping the address", () => {
  it("leaves a short address on one line", () => {
    expect(wrapToWidth("barzedoze.com.br/market", 200, 6, 2)).toEqual([
      "barzedoze.com.br/market",
    ]);
  });

  it("truncates rather than growing a third line — deciding is the caller's", () => {
    // Its whole contract, and the reason `fitLines` exists on top of it: at a
    // FIXED size the subproduct address needs three lines on the smallest
    // sticker, so two come back short. Shrinking until it is whole is the
    // decision, and this function does not make decisions.
    const lines = wrapToWidth(SUBPRODUCT_URL, SMALL_STICKER_WIDTH, 5, 2);
    expect(lines).toHaveLength(2);
    expect(lines.join("").length).toBeLessThan(SUBPRODUCT_URL.length);
  });

  it("keeps every line inside the width it was given", () => {
    for (const line of wrapToWidth("m".repeat(120), 60, 6, 2)) {
      expect(helveticaWidth(line, 6)).toBeLessThanOrEqual(60);
    }
  });

  it("stops at the line cap rather than growing a third line", () => {
    // The signal the caller shrinks on: fewer characters back than went in.
    const lines = wrapToWidth("m".repeat(400), 60, 6, 2);
    expect(lines).toHaveLength(2);
    expect(lines.join("").length).toBeLessThan(400);
  });
});
