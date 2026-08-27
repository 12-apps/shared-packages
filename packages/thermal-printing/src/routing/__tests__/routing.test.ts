import { describe, expect, it } from "vitest";

import { printerFor, printerRoute, type RoutablePrinter } from "../index";

/**
 * Which printer takes which order.
 *
 * The decision most likely to be got subtly wrong, and the one whose wrong
 * version prints somebody's work in the wrong room rather than throwing.
 */

const printer = (id: string, destinationId: string | null, active = true): RoutablePrinter => ({
  id,
  destinationId,
  active,
});

describe("printerFor", () => {
  it("sends a destination's order to that destination's printer", () => {
    const route = printerRoute([printer("default", null), printer("bar", "s-bar")]);

    expect(printerFor(route, "s-bar")?.id).toBe("bar");
  });

  it("sends a order with NO destination to the default", () => {
    // Anything the host does not group by destination — and for a host that
    // does not use the grouping at all, everything.
    const route = printerRoute([printer("default", null), printer("bar", "s-bar")]);

    expect(printerFor(route, null)?.id).toBe("default");
  });

  it("falls back to the default for a destination nobody configured a printer for", () => {
    const route = printerRoute([printer("default", null)]);

    expect(printerFor(route, "s-varanda")?.id).toBe("default");
  });

  it("covers nothing when a host has only ONE destination's printer", () => {
    // A normal answer, not a failure: that store genuinely does not print the
    // rest of its board, and the manual reprint says so in words rather than
    // printing it somewhere arbitrary.
    const route = printerRoute([printer("bar", "s-bar")]);

    expect(printerFor(route, null)).toBeNull();
    expect(printerFor(route, "s-varanda")).toBeNull();
  });

  it("stops a destination's tickets when its printer is switched off — never relocates them", () => {
    // The bug the integration suite caught: turning the Bar's printer off for
    // the night must not quietly start printing the bar's food at the counter.
    // A destination that OWNS a printer is answered by that printer or by nothing.
    const route = printerRoute([printer("default", null), printer("bar", "s-bar", false)]);

    expect(printerFor(route, "s-bar")).toBeNull();
    // …and the rest of the board is untouched by that decision.
    expect(printerFor(route, null)?.id).toBe("default");
  });

  it("still falls a destination with NO printer of its own through to the default", () => {
    // The difference that makes the case above safe to state: "no printer here"
    // and "the printer here is off tonight" are different facts.
    const route = printerRoute([printer("default", null), printer("bar", "s-bar", false)]);

    expect(printerFor(route, "s-varanda")?.id).toBe("default");
  });

  it("leaves a store whose DEFAULT is switched off printing nothing unrouted", () => {
    const route = printerRoute([printer("default", null, false), printer("bar", "s-bar")]);

    expect(printerFor(route, null)).toBeNull();
    expect(printerFor(route, "s-bar")?.id).toBe("bar");
  });
});
