import { describe, expect, it } from "vitest";

import type { DiscountRule } from "../types";
import {
  clock,
  evaluateCart,
  expectMoneyInvariant,
  freeUnitsRule,
  FRI,
  line,
  MON,
  percentRule,
  reasonFor,
  schedule,
  slot,
  THU,
  TUE,
} from "./fixtures";

/**
 * Unit (FUT-996): the schedule as the EVALUATOR sees it.
 *
 * Driven through `evaluateDiscounts` rather than through the predicate, for the
 * reason the eligibility suite gives: what the ticket promises is "this shopper
 * is charged this much", and asserting the screen alone would let the two
 * drift. The predicate's own arithmetic is pinned in `schedule.test.ts`.
 *
 * The cart is one 1000-cent line unless a case says otherwise, so a 10% rule
 * removes exactly 100 cents and "did the schedule let it through" reads as a
 * number rather than as a flag.
 */

const BEER = line({
  lineId: "beer",
  menuItemId: "m-beer",
  categoryPath: ["c-beer"],
  unitPriceCents: 1_000,
});

/** A happy hour on the beer CATEGORY — the promotion in the ticket. */
function happyHour(overrides: Partial<DiscountRule> = {}): DiscountRule {
  return percentRule(10, {
    id: "hh",
    scope: "CATEGORY",
    targetCategoryIds: ["c-beer"],
    schedule: schedule([FRI], "16:00", "20:00"),
    ...overrides,
  });
}

describe("a scheduled rule follows the LINE's commit instant", () => {
  it("applies to a line committed inside the window", () => {
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [{ ...BEER, committedLocal: clock(FRI, "19:55") }],
      localNow: clock(FRI, "19:55"),
    });
    expect(result.discountTotalCents).toBe(100);
    expectMoneyInvariant(result);
  });

  it("still applies at 20:05 to a line committed at 19:55 — the guarantee", () => {
    // FUT-996 decision 2. The shopper earned the price when the beer went into
    // the cart; the checkout instant is not what they were shown. Pricing this
    // at `now` is the daily, predictable, queue-of-shoppers failure the whole
    // commit-instant rule exists to prevent.
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [{ ...BEER, committedLocal: clock(FRI, "19:55") }],
      localNow: clock(FRI, "20:05"),
    });
    expect(result.discountTotalCents).toBe(100);
  });

  it("does NOT apply to a line committed after the window closed", () => {
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [{ ...BEER, committedLocal: clock(FRI, "20:05") }],
      localNow: clock(FRI, "20:05"),
    });
    expect(result.discountTotalCents).toBe(0);
  });

  it("discounts only the QUALIFYING lines of a straddling cart", () => {
    // The honest answer, and the one that falls out of R3: two beers, one
    // bought during happy hour and one after, are two different facts.
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [
        { ...BEER, lineId: "in", committedLocal: clock(FRI, "19:55") },
        { ...BEER, lineId: "out", committedLocal: clock(FRI, "20:05") },
      ],
      localNow: clock(FRI, "20:05"),
    });
    expect(result.discountTotalCents).toBe(100);
    const discounted = result.lines.filter((l) => l.discountCents > 0).map((l) => l.lineId);
    expect(discounted).toEqual(["in"]);
    expectMoneyInvariant(result);
  });

  it("ignores the schedule entirely when the host resolved no clock", () => {
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [{ ...BEER, committedLocal: null }],
      localNow: null,
    });
    expect(result.discountTotalCents).toBe(100);
  });
});

describe("a rule with NO schedule is untouched", () => {
  it("prices exactly as it did before the feature", () => {
    const plain = percentRule(10, {
      id: "plain",
      scope: "CATEGORY",
      targetCategoryIds: ["c-beer"],
    });
    const result = evaluateCart({
      rules: [plain],
      lines: [{ ...BEER, committedLocal: clock(MON, "03:00") }],
      localNow: clock(MON, "03:00"),
    });
    expect(result.discountTotalCents).toBe(100);
  });
});

describe("ORDER scope screens at CHECKOUT, not per line", () => {
  // The one asymmetry (FUT-996 decision 6): an order-wide discount names no
  // line, and the order comes into existence at checkout. Surfaced to the
  // operator in the form rather than left invisible.
  const orderWide = (): DiscountRule =>
    percentRule(10, { id: "ow", scope: "ORDER", schedule: schedule([FRI], "16:00", "20:00") });

  it("applies when CHECKOUT is inside the window", () => {
    const result = evaluateCart({
      rules: [orderWide()],
      lines: [{ ...BEER, committedLocal: clock(FRI, "10:00") }],
      localNow: clock(FRI, "17:00"),
    });
    expect(result.discountTotalCents).toBe(100);
  });

  it("does NOT apply when checkout is outside it, however the lines were committed", () => {
    const result = evaluateCart({
      rules: [orderWide()],
      lines: [{ ...BEER, committedLocal: clock(FRI, "17:00") }],
      localNow: clock(FRI, "20:05"),
    });
    expect(result.discountTotalCents).toBe(0);
  });
});

describe("a COMBO is RE-MATCHED over the qualifying lines", () => {
  // Not intersected: a combo's coverage is a MATCH, so "leve 3, pague 2 na
  // terça à tarde" must not assemble itself from two units bought in the
  // afternoon and one bought at night.
  const afternoon = () =>
    freeUnitsRule(1, [slot({ menuItemIds: ["m-chup"], quantity: 3 })], {
      id: "chup",
      schedule: schedule([TUE], "12:00", "18:00"),
    });

  const chup = (lineId: string, at: string) =>
    line({
      lineId,
      menuItemId: "m-chup",
      unitPriceCents: 500,
      committedLocal: clock(TUE, at),
    });

  it("applies when every unit was committed inside the window", () => {
    const result = evaluateCart({
      rules: [afternoon()],
      lines: [chup("a", "13:00"), chup("b", "13:05"), chup("c", "13:10")],
      localNow: clock(TUE, "13:10"),
    });
    // Three at 500; the cheapest one is free.
    expect(result.discountTotalCents).toBe(500);
    expectMoneyInvariant(result);
  });

  it("refuses to assemble from units straddling the window", () => {
    const result = evaluateCart({
      rules: [afternoon()],
      lines: [chup("a", "13:00"), chup("b", "13:05"), chup("c", "19:00")],
      localNow: clock(TUE, "19:00"),
    });
    expect(result.discountTotalCents).toBe(0);
  });
});

describe("OUT_OF_SCHEDULE reaches a buyer who typed the coupon", () => {
  it("is reported instead of NO_ELIGIBLE_ITEMS when the hour is the only problem", () => {
    // The distinction that earns the key: this cart DOES hold what the coupon
    // covers, so "não vale para os itens do seu carrinho" would be false and
    // "expirado" would send them away from a shop that sells it at 16:00.
    const reason = reasonFor(
      evaluateCart({
        rules: [happyHour({ trigger: "CODE", code: "HAPPY" })],
        lines: [{ ...BEER, committedLocal: clock(FRI, "10:00") }],
        couponCode: "HAPPY",
        localNow: clock(FRI, "10:00"),
      }),
      "hh",
    );
    expect(reason).toBe("OUT_OF_SCHEDULE");
  });

  it("still reports NO_ELIGIBLE_ITEMS when the cart holds nothing it covers", () => {
    const reason = reasonFor(
      evaluateCart({
        rules: [happyHour({ trigger: "CODE", code: "HAPPY" })],
        lines: [line({ lineId: "food", categoryPath: ["c-food"], committedLocal: clock(FRI, "17:00") })],
        couponCode: "HAPPY",
        localNow: clock(FRI, "17:00"),
      }),
      "hh",
    );
    expect(reason).toBe("NO_ELIGIBLE_ITEMS");
  });

  it("reports the campaign's own EXPIRED ahead of the hour", () => {
    // Least- to most-specific ordering is unchanged: a campaign that is over is
    // over, whatever the clock says about Fridays.
    const reason = reasonFor(
      evaluateCart({
        rules: [
          happyHour({
            trigger: "CODE",
            code: "HAPPY",
            endsAt: new Date("2026-03-01T00:00:00.000Z"),
          }),
        ],
        lines: [{ ...BEER, committedLocal: clock(FRI, "10:00") }],
        couponCode: "HAPPY",
        localNow: clock(FRI, "10:00"),
      }),
      "hh",
    );
    expect(reason).toBe("EXPIRED");
  });

  it("says nothing about an AUTOMATIC rule that is merely out of hours", () => {
    // A buyer must never be shown a promotion they cannot have.
    const result = evaluateCart({
      rules: [happyHour()],
      lines: [{ ...BEER, committedLocal: clock(THU, "17:00") }],
      localNow: clock(THU, "17:00"),
    });
    expect(result.rejections).toEqual([]);
    expect(result.discountTotalCents).toBe(0);
  });
});

describe("scheduled rules interact with the rest of the engine unchanged", () => {
  it("a non-stackable happy hour displaces other promos ONLY during its hours", () => {
    // This is the interaction that generates the support ticket: an exclusive
    // scheduled rule suppresses everything else, but only for four hours a
    // week, which is exactly the intermittent behaviour nobody reproduces.
    const exclusive = happyHour({ stackable: false });
    const alwaysOn = percentRule(5, { id: "five" });

    const inside = evaluateCart({
      rules: [exclusive, alwaysOn],
      lines: [{ ...BEER, committedLocal: clock(FRI, "17:00") }],
      localNow: clock(FRI, "17:00"),
    });
    // 10% of the beer beats a stacked 5% of the order, so the exclusive wins
    // outright and the 5% is displaced.
    expect(inside.applied.map((a) => a.discountId)).toEqual(["hh"]);
    expect(inside.discountTotalCents).toBe(100);

    const outside = evaluateCart({
      rules: [exclusive, alwaysOn],
      lines: [{ ...BEER, committedLocal: clock(FRI, "10:00") }],
      localNow: clock(FRI, "10:00"),
    });
    // Out of hours it is not even a candidate, so the ordinary promo is back.
    expect(outside.applied.map((a) => a.discountId)).toEqual(["five"]);
    expect(outside.discountTotalCents).toBe(50);
  });

  it("a stackable coupon still forces the stack, schedule or not", () => {
    // Unchanged R8: "a coupon the buyer explicitly typed is never silently
    // discarded". Pinned here because a scheduled exclusive rule is a new way
    // to reach this branch, and the answer must not have moved.
    const exclusive = happyHour({ stackable: false });
    const coupon = percentRule(5, { id: "cup", trigger: "CODE", code: "CINCO" });
    const result = evaluateCart({
      rules: [exclusive, coupon],
      lines: [{ ...BEER, committedLocal: clock(FRI, "17:00") }],
      couponCode: "CINCO",
      localNow: clock(FRI, "17:00"),
    });
    expect(result.applied.map((a) => a.discountId)).toEqual(["cup"]);
  });

  it("honours minSubtotalCents against the untouched subtotal as before", () => {
    const result = evaluateCart({
      rules: [happyHour({ minSubtotalCents: 5_000 })],
      lines: [{ ...BEER, committedLocal: clock(FRI, "17:00") }],
      localNow: clock(FRI, "17:00"),
    });
    expect(result.discountTotalCents).toBe(0);
  });
});
