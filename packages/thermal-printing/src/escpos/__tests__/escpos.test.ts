import { describe, expect, it } from "vitest";

import { encodeTicket } from "../index";
import type { TicketLine } from "../../index";

/**
 * The bytes a thermal printer actually receives.
 *
 * The code page is the case worth the most here. Sending UTF-8 to a receipt
 * printer puts two characters where a `ç` should be — reliably, on every
 * printer, in a way that looks like a font problem and is not — and nothing but
 * a byte-level assertion catches it before somebody reads the paper.
 */

const line = (text: string, emphasis: TicketLine["emphasis"] = "normal"): TicketLine => ({
  text,
  align: "left",
  emphasis,
});

describe("encodeTicket", () => {
  it("initialises the printer and selects CP850", () => {
    const bytes = encodeTicket([line("ok")]);

    // ESC @ (init), then ESC t 2 (code page 850).
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x02]);
  });

  it("encodes Portuguese accents as CP850 rather than UTF-8", () => {
    const bytes = encodeTicket([line("Endereço")]);

    // One byte per character, and `ç` is 0x87 in CP850 — not the two bytes
    // UTF-8 would send, which is what prints as mojibake.
    expect([...bytes].filter((byte) => byte === 0x87)).toHaveLength(1);
    expect([...bytes]).not.toContain(0xc3);
  });

  it("covers the Latin-script alphabet a ticket is written in", () => {
    const accented = "ãõáéíóúâêôàçüÃÕÁÉÍÓÚÂÊÔÀÇ";
    const bytes = [...encodeTicket([line(accented)])];

    // `?` is the last-resort byte. Its presence here would mean the table has a
    // hole in exactly the alphabet most adopters write in.
    expect(bytes).not.toContain(0x3f);
  });

  it("degrades an unmappable character to its unaccented letter, not to `?`", () => {
    // "Maracuja" is a word somebody can still read; a `?` mid-word is not.
    const bytes = [...encodeTicket([line("ǎ")])];

    expect(bytes).toContain(0x61); // "a"
    expect(bytes).not.toContain(0x3f);
  });

  it("falls back to `?` only for a glyph with no letter behind it", () => {
    const bytes = [...encodeTicket([line("😀")])];

    expect(bytes).toContain(0x3f);
  });

  it("switches character mode only when it changes", () => {
    const bytes = [...encodeTicket([line("a", "bold"), line("b", "bold"), line("c")])];
    const modeCommands = bytes.filter((byte, index) => byte === 0x21 && bytes[index - 1] === 0x1b);

    // Bold on, back to normal for "c", and the reset before the cut. A command
    // per line would triple the bytes on a queue of long tickets.
    expect(modeCommands).toHaveLength(3);
  });

  it("uses double HEIGHT and never double width", () => {
    const bytes = [...encodeTicket([line("MESA 12", "double")])];
    const modeIndex = bytes.findIndex((byte, index) => byte === 0x21 && bytes[index - 1] === 0x1b);

    // 0x18 is height + emphasis. 0x38 would add width, which halves the columns
    // and silently rewraps a headline the layout already measured.
    expect(bytes[modeIndex + 1]).toBe(0x18);
  });

  it("feeds before cutting, so the cut misses the last lines", () => {
    const bytes = [...encodeTicket([line("ok")])];

    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    // The cutter sits above the print head; without the feed the cut lands in
    // the middle of what somebody still has to read.
    expect(bytes.slice(-8, -4)).toEqual([0x0a, 0x0a, 0x0a, 0x0a]);
  });
});
