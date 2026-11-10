import { describe, expect, it } from "vitest";

import { encodeTicket } from "../escpos";
import {
  DEFAULT_LINE_SPACING_UNIT,
  isLineSpacingUnit,
  LINE_SPACING_UNITS,
  lineSpacingFor,
  lineTestSheet,
  textWidth,
  type LineSpacingUnit,
} from "../index";

/**
 * `ESC 3 n` in the printer's own unit, and the sheet that finds the unit.
 *
 * The unit is a per-printer fact the encoder cannot detect, so the two things
 * worth pinning are that the default changes nothing and that the line-test
 * sheet prints each unit where it says it does.
 */

const ESC = 0x1b;

/** Every `n` of every `ESC 3 n` in a stream, in order. */
const spacings = (stream: readonly number[]): number[] =>
  stream.flatMap((byte, index) => (byte === ESC && stream[index + 1] === 0x33 ? [stream[index + 2] ?? -1] : []));

describe("lineSpacingFor", () => {
  it("is the height in dots by default", () => {
    expect(DEFAULT_LINE_SPACING_UNIT).toBe("dot");
    expect([17, 24, 34, 48].map((dots) => lineSpacingFor(dots))).toEqual([17, 24, 34, 48]);
  });

  it("doubles it in 1/360 inch, under the TM-T88's 180-dpi head", () => {
    expect([17, 24, 34, 48].map((dots) => lineSpacingFor(dots, "inch-360"))).toEqual([34, 48, 68, 96]);
  });

  it("clamps to the one byte the command holds", () => {
    expect(lineSpacingFor(200, "inch-360")).toBe(255);
    expect(lineSpacingFor(Number.POSITIVE_INFINITY)).toBe(255);
    expect(lineSpacingFor(-3)).toBe(0);
    expect(lineSpacingFor(Number.NaN)).toBe(0);
  });

  it.each(["furlong", "constructor", "__proto__", "toString"])("reads the unknown unit %s as the dot", (unit) => {
    expect(isLineSpacingUnit(unit)).toBe(false);
    expect(lineSpacingFor(24, unit as LineSpacingUnit)).toBe(24);
  });

  it("knows every unit it lists", () => {
    expect(LINE_SPACING_UNITS.every(isLineSpacingUnit)).toBe(true);
  });
});

describe("lineTestSheet", () => {
  it("numbers one section per unit, the default first", () => {
    const sheet = lineTestSheet();

    expect(sheet.map(({ number, unit }) => [number, unit])).toEqual([
      [1, "dot"],
      [2, "inch-360"],
    ]);
    expect(LINE_SPACING_UNITS[0]).toBe(DEFAULT_LINE_SPACING_UNIT);
  });

  it("pins every framed line of a section to its unit and carries only digits", () => {
    for (const section of lineTestSheet()) {
      const framed = section.lines.filter((line) => line.frame !== undefined);

      expect(framed.map((line) => line.frame)).toEqual(["box", "box", "box", "band", "band"]);
      // Narrow enough for a 180-dpi head on a 58 mm roll (360 dots of 12-dot Font A).
      expect(framed.every((line) => textWidth(line.text) === 20 && line.size === undefined)).toBe(true);
      expect(framed.every((line) => line.lineSpacingUnit === section.unit)).toBe(true);
      expect(section.lines.map((line) => line.text).join("")).not.toMatch(/\p{L}/u);
      expect(section.lines.some((line) => line.text.includes(String(section.number)))).toBe(true);
    }
  });

  it("encodes box 1 in dots and box 2 in 1/360 inch on one roll, whatever the option says", () => {
    const lines = lineTestSheet().flatMap((section) => section.lines);
    const expected = [24, 48]; // Font A in dots, then the same in 1/360 inch

    expect(spacings([...encodeTicket(lines)])).toEqual(expected);
    expect(spacings([...encodeTicket(lines, { lineSpacingUnit: "inch-360" })])).toEqual(expected);
  });
});
