import { describe, expect, it } from "vitest";

import { DRAWER_PULSE_DEFAULTS, encodeDrawerPulse, encodeTicket } from "../index";

/**
 * `ESC p m t1 t2` — the cash drawer kick.
 *
 * A drawer has no interface of its own: it hangs off the printer's RJ-11
 * "DK" port, and the printer energises the solenoid when it reads this
 * command. So the whole contract is five bytes, and a byte-level assertion is
 * the only test that means anything without a drawer on the bench.
 */

const ESC = 0x1b;

describe("encodeDrawerPulse", () => {
  it("encodes the conventional kick on pin 2: 50 ms on, 500 ms off", () => {
    expect([...encodeDrawerPulse()]).toEqual([ESC, 0x70, 0x00, 25, 250]);
  });

  it("names the defaults it encodes", () => {
    expect(DRAWER_PULSE_DEFAULTS).toEqual({ pin: 2, onMs: 50, offMs: 500 });
  });

  it("selects pin 5 with m = 1, for a second drawer on the same port", () => {
    expect([...encodeDrawerPulse({ pin: 5 })]).toEqual([ESC, 0x70, 0x01, 25, 250]);
  });

  it("counts both times in the command's 2 ms units, rounding to the nearest", () => {
    expect([...encodeDrawerPulse({ onMs: 100, offMs: 201 })]).toEqual([ESC, 0x70, 0x00, 50, 101]);
  });

  it("clamps a time the single byte cannot hold to 255 units (510 ms)", () => {
    expect([...encodeDrawerPulse({ onMs: 9_999, offMs: 9_999 })]).toEqual([ESC, 0x70, 0x00, 255, 255]);
  });

  it("never sends an off time shorter than the on time", () => {
    // The printers in this class treat t2 < t1 as t2 = t1; sending that
    // explicitly keeps a printer that does not from cutting the kick short.
    expect([...encodeDrawerPulse({ onMs: 200, offMs: 20 })]).toEqual([ESC, 0x70, 0x00, 100, 100]);
  });

  it("treats a negative or non-finite time as the default rather than throwing", () => {
    // A drawer that opens with the usual kick is better than a sale that
    // throws on a bad setting.
    expect([...encodeDrawerPulse({ onMs: -5, offMs: Number.NaN })]).toEqual([ESC, 0x70, 0x00, 25, 250]);
  });

  it("is free of initialise and cut, so it can be written alone or after a ticket", () => {
    const pulse = [...encodeDrawerPulse()];
    const ticket = [...encodeTicket([{ text: "ok", align: "left", emphasis: "normal" }])];

    expect(pulse).not.toContain(0x40);
    expect([...ticket, ...pulse].slice(-5)).toEqual(pulse);
  });
});
