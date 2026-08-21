import { describe, expect, it } from "vitest";

import { createFormatters, EMPTY, formatDiscountValue, formatWindow, windowStateOf } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";

/**
 * Money, percentages and dates — in one locale's notation, and READ BACK from
 * it.
 *
 * The origin hard-coded a locale and a currency in five places, which is copy
 * leaking into logic: "12,5" is not a translation of "12.5", it is the same
 * number written for a different reader. These cases drive TWO locales for
 * exactly that reason — a suite that only ever exercised the origin's would
 * pass against a hard-coded separator, which is the bug.
 */

/**
 * Built per CALL rather than once at module scope. `Intl` formatters are
 * stateless, but a module-level binding is the shape this repo's flakiness gate
 * refuses outright — and the rule is right in general, so the cheap answer is
 * to stop having one rather than to argue the exception.
 */
const brazil = (): ReturnType<typeof createFormatters> => createFormatters("pt-BR", "BRL");
const america = (): ReturnType<typeof createFormatters> => createFormatters("en-US", "USD");
const copy = PT_BR_DISCOUNTS_WEB_COPY;

describe("writing a number for its reader", () => {
  it("F1: renders integer cents as that locale's money", () => {
    expect(brazil().money(1_990)).toContain("19,90");
    expect(america().money(1_990)).toContain("19.90");
  });

  it("F2: renders basis points as the percentage an operator recognises", () => {
    // The storage unit exists so "12,5%" survives a round trip; this is where
    // it turns back into a percentage.
    expect(brazil().percent(1_250)).toBe("12,5%");
    expect(america().percent(1_250)).toBe("12.5%");
  });

  it("F3: answers the dash for a value that is not there", () => {
    expect(brazil().money(null)).toBe(EMPTY);
    expect(brazil().percent(null)).toBe(EMPTY);
    expect(brazil().date(null)).toBe(EMPTY);
  });
});

describe("reading back what the operator typed", () => {
  it("F4: parses the decimal separator THIS locale writes", () => {
    expect(brazil().parseDecimal("12,5")).toBe(12.5);
    expect(america().parseDecimal("12.5")).toBe(12.5);
  });

  it("F5: strips the group separator rather than treating it as a decimal", () => {
    // The case a naive `replace(",", ".")` gets wrong in both directions.
    expect(brazil().parseDecimal("1.234,56")).toBe(1234.56);
    expect(america().parseDecimal("1,234.56")).toBe(1234.56);
  });

  it("F6: answers null for blank, which is NOT zero", () => {
    // A blank limit means "no cap"; zero means "nobody may redeem it". Folding
    // the two is the single most expensive coercion mistake on this form.
    expect(brazil().parseDecimal("")).toBeNull();
    expect(brazil().parseDecimal("   ")).toBeNull();
    expect(brazil().parseDecimal("abc")).toBeNull();
  });

  it("F7: writes a number back the way that reader would type it", () => {
    expect(brazil().toInput(12.5)).toBe("12,5");
    expect(america().toInput(12.5)).toBe("12.5");
  });
});

describe("a calendar date is read in UTC", () => {
  it("F8: shows the day that was typed, not the day the browser is having", () => {
    // The column holds a calendar date at UTC midnight. Formatted in a zone
    // west of Greenwich it would show the day BEFORE — a promotion that appears
    // to start yesterday.
    expect(brazil().date("2026-08-01T00:00:00.000Z")).toBe("01/08/2026");
    expect(america().date("2026-08-01T00:00:00.000Z")).toBe("8/1/2026");
  });

  it("F9: shows an unparseable value rather than swallowing it", () => {
    expect(brazil().date("not-a-date")).toBe("not-a-date");
  });
});

describe("what a rule takes off", () => {
  const row = (overrides: Record<string, unknown>) =>
    ({
      type: "PERCENTAGE",
      percentOffBp: null,
      amountOffCents: null,
      ...overrides,
    }) as Parameters<typeof formatDiscountValue>[0];

  it("F10: reads the ONE value column its type actually stores", () => {
    expect(formatDiscountValue(row({ percentOffBp: 1_000 }), brazil())).toBe("10%");
    expect(
      formatDiscountValue(row({ type: "FIXED_AMOUNT", amountOffCents: 300 }), brazil()),
    ).toContain("3,00");
    expect(
      formatDiscountValue(row({ type: "BUNDLE_PRICE", bundlePriceCents: 2_500 }), brazil()),
    ).toContain("25,00");
  });

  it("F11: has no single number for a free-units combo, and says so", () => {
    // "One of them is free" is not an amount. A column that invented one would
    // be quoting a discount the buyer might not get.
    expect(formatDiscountValue(row({ type: "FREE_UNITS", freeUnits: 1 }), brazil())).toBe(EMPTY);
  });
});

describe("the validity sentence", () => {
  const sentence = (startsAt: string | null, endsAt: string | null) =>
    formatWindow({ startsAt, endsAt }, brazil(), copy);

  it("F12: phrases all four shapes differently", () => {
    // A dash on one side would leave the operator guessing whether the rule has
    // no start or no end, and those mean very different things when it is not
    // running yet.
    expect(sentence(null, null)).toBe("Sem prazo");
    expect(sentence("2026-08-01T00:00:00.000Z", null)).toBe("A partir de 01/08/2026");
    expect(sentence(null, "2026-09-01T00:00:00.000Z")).toBe("Até 01/09/2026");
    expect(sentence("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBe(
      "01/08/2026 a 01/09/2026",
    );
  });
});

describe("where a rule sits relative to its window", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("F13: an open-ended rule is running", () => {
    expect(windowStateOf({ startsAt: null, endsAt: null }, now)).toBe("RUNNING");
  });

  it("F14: a future start is scheduled", () => {
    expect(windowStateOf({ startsAt: "2026-12-01T00:00:00.000Z", endsAt: null }, now)).toBe(
      "SCHEDULED",
    );
  });

  it("F15: the window is HALF-OPEN — it ends the instant its end begins", () => {
    expect(windowStateOf({ startsAt: null, endsAt: "2026-08-21T12:00:00.000Z" }, now)).toBe(
      "ENDED",
    );
    expect(windowStateOf({ startsAt: null, endsAt: "2026-08-21T12:00:00.001Z" }, now)).toBe(
      "RUNNING",
    );
  });
});
