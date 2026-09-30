import { describe, expect, it } from "vitest";

import { pageSizeFor, rollFor } from "../page";

/**
 * The page a ticket is printed on (FUT-3009): the roll the body was laid out
 * for, as tall as the ticket.
 */

describe("rollFor", () => {
  it("reads the roll off the body `./html` sets to its printable width", () => {
    // Layout rounds a 72 mm body down to 71.97 mm, and 48 mm to 47.89 mm.
    expect(rollFor(71.97)).toBe(80);
    expect(rollFor(47.89)).toBe(58);
  });

  it("never takes 58 mm for enough to hold a body a little wider than 48 mm", () => {
    expect(rollFor(49)).toBe(80);
  });

  it("puts a body wider than every roll on the widest, as a pre-FUT-2987 document was", () => {
    expect(rollFor(91.4)).toBe(80);
  });
});

describe("pageSizeFor", () => {
  it("is the roll's full width, and the ticket's height plus a centimetre, in microns", () => {
    expect(pageSizeFor(80, { widthMm: 72, heightMm: 246.59 })).toEqual({ width: 80_000, height: 257_000 });
  });

  it("keeps a short ticket's page portrait, so no driver rotates it onto the roll", () => {
    expect(pageSizeFor(80, { widthMm: 72, heightMm: 20 })).toEqual({ width: 80_000, height: 80_000 });
  });
});
