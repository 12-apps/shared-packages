import { describe, expect, it } from "vitest";

import { encodeTicket } from "../index";
import { band, box, centered, image, line, row, textLines } from "../../index";

/**
 * The newer line kinds, byte by byte.
 *
 * Each assertion names the command it expects, because the failure mode of a
 * wrong byte here is paper that looks almost right.
 */

const ESC = 0x1b;
const GS = 0x1d;
const PREAMBLE = [ESC, 0x40, ESC, 0x74, 0x02];
const TAIL = [ESC, 0x21, 0x00, ESC, 0x61, 0x00, 0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00];
/** Where `command` first starts in `encoded`, or -1. */
const indexOfCommand = (stream: readonly number[], command: readonly number[]): number =>
  stream.findIndex((_, index) => command.every((byte, offset) => stream[index + offset] === byte));

/** The 8-byte header of every `GS v 0` in `encoded`. */
const rasterHeaders = (stream: readonly number[]): number[][] =>
  stream.flatMap((byte, index) =>
    byte === GS && stream[index + 1] === 0x76 ? [stream.slice(index, index + 8)] : [],
  );

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

describe("legacy tickets", () => {
  it("encode to exactly the encoded they always did", () => {
    const encoded = [...encodeTicket([line("A", "bold"), centered("B", "double"), line("C")])];

    expect(encoded).toEqual([
      ...PREAMBLE,
      ESC, 0x21, 0x08, ...ascii("A"), 0x0a,
      ESC, 0x21, 0x18, ESC, 0x61, 0x01, ...ascii("B"), 0x0a,
      ESC, 0x21, 0x00, ESC, 0x61, 0x00, ...ascii("C"), 0x0a,
      ...TAIL,
    ]);
  });
});

describe("sizes", () => {
  it.each([
    ["small", 0x01],
    ["medium", 0x00],
    ["large", 0x31],
    ["xlarge", 0x30],
  ] as const)("selects %s with ESC ! 0x%s", (size, mode) => {
    const sizedBytes = [...encodeTicket([...textLines("Z", 80, { size })])];
    const expected = mode === 0x00 ? [...ascii("Z"), 0x0a] : [ESC, 0x21, mode, ...ascii("Z"), 0x0a];

    expect(sizedBytes.slice(PREAMBLE.length, PREAMBLE.length + expected.length)).toEqual(expected);
  });

  it("adds the emphasis bit to a bold size", () => {
    const encoded = [...encodeTicket(textLines("Z", 80, { size: "xlarge", bold: true }))];

    expect(encoded.slice(5, 8)).toEqual([ESC, 0x21, 0x38]);
  });
});

describe("band", () => {
  it("prints white on black with GS B 1, on closed line spacing, then turns both off", () => {
    const lines = band("VOID", 58);
    const encoded = [...encodeTicket([...lines, line("after")])];

    expect(encoded).toEqual([
      ...PREAMBLE,
      ESC, 0x21, 0x08, // bold
      GS, 0x42, 0x01, // reverse on
      ESC, 0x33, 24, // line spacing = the Font A cell, so band lines touch
      ...ascii(lines[0]?.text ?? ""), 0x0a,
      ESC, 0x21, 0x00,
      GS, 0x42, 0x00, // reverse off before ordinary text
      ESC, 0x32, // default spacing
      ...ascii("after"), 0x0a,
      ...TAIL,
    ]);
  });

  it("never leaves reverse on for the next job", () => {
    const encoded = [...encodeTicket(band("VOID", 80))];

    expect(encoded.slice(-TAIL.length - 5, -TAIL.length)).toEqual([GS, 0x42, 0x00, ESC, 0x32]);
  });
});

describe("box", () => {
  it("prints the border as CP850 box-drawing encoded on closed line spacing", () => {
    const encoded = [...encodeTicket(box("OK", 58, { size: "large" }))];
    const body = encoded.slice(PREAMBLE.length);

    // Font B doubled, bold; spacing 34 dots = the cell, so the verticals join.
    expect(body.slice(0, 6)).toEqual([ESC, 0x21, 0x39, ESC, 0x33, 34]);
    expect(body[6]).toBe(0xda); // ┌
    expect(body.slice(7, 26).every((byte) => byte === 0xc4)).toBe(true); // ─
    expect(body[26]).toBe(0xbf); // ┐
    expect(encoded).toContain(0xb3); // │
    expect(encoded).toContain(0xc0); // └
    expect(encoded).toContain(0xd9); // ┘
    expect(encoded).not.toContain(0x3f); // no `?` fallback anywhere
  });
});

describe("row", () => {
  it("is plain text already padded to the roll: the encoder adds nothing", () => {
    const [only] = row("Total", "9.90", 58);
    const encoded = [...encodeTicket(row("Total", "9.90", 58))];

    expect(encoded.slice(PREAMBLE.length, PREAMBLE.length + 33)).toEqual([...ascii(only?.text ?? ""), 0x0a]);
  });
});

describe("image", () => {
  it("sends the raster as GS v 0 with its byte width and row count, centred", () => {
    const raster = { width: 10, height: 2, data: Uint8Array.of(0xff, 0xc0, 0x80, 0x40) };
    const encoded = [...encodeTicket([image(raster)])];

    expect(encoded.slice(PREAMBLE.length)).toEqual([
      ESC, 0x61, 0x01,
      GS, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0xff, 0xc0, 0x80, 0x40,
      ...TAIL,
    ]);
  });

  it("splits a tall raster into strips of at most 255 rows", () => {
    const raster = { width: 8, height: 300, data: new Uint8Array(300).fill(0xaa) };
    const headers = rasterHeaders([...encodeTicket([image(raster, "left")])]);

    expect(headers).toEqual([
      [GS, 0x76, 0x30, 0x00, 1, 0, 255, 0],
      [GS, 0x76, 0x30, 0x00, 1, 0, 45, 0],
    ]);
  });

  it("prints the rows a short buffer has rather than throwing", () => {
    const raster = { width: 16, height: 10, data: Uint8Array.of(1, 2, 3) };
    const encoded = [...encodeTicket([image(raster, "left")])];

    expect(encoded.slice(PREAMBLE.length, PREAMBLE.length + 10)).toEqual([GS, 0x76, 0x30, 0x00, 2, 0, 1, 0, 1, 2]);
  });

  it("turns reverse off before a picture", () => {
    const raster = { width: 8, height: 1, data: Uint8Array.of(0xff) };
    const encoded = [...encodeTicket([...band("X", 58), image(raster)])];
    const reverseOff = indexOfCommand(encoded, [GS, 0x42, 0x00]);
    const raster0 = indexOfCommand(encoded, [GS, 0x76]);

    expect(reverseOff).toBeGreaterThan(-1);
    expect(reverseOff).toBeLessThan(raster0);
  });
});
