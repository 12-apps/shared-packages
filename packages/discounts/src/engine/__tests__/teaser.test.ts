import { describe, expect, it } from "vitest";

import { previewItemDiscount } from "../preview";
import { upcomingOffersForItem } from "../teaser";
import type { DiscountRule } from "../types";
import { clock, FRI, NOW, percentRule, schedule, THU, TUE } from "./fixtures";

/**
 * Unit (FUT-996): the teaser — what a card may say about a promotion that has
 * not started yet.
 *
 * The property under test is the one the ticket argues for at length: a card
 * may advertise the OFFER before its hours, and may never advertise the PRICE.
 * So every case here checks the teaser and `previewItemDiscount` TOGETHER — a
 * teaser that appeared alongside a struck price would be exactly the lie the
 * separation exists to prevent, and neither assertion alone would catch it.
 */

const HAPPY_HOUR = percentRule(10, {
  id: "hh",
  name: "Happy hour",
  scope: "CATEGORY",
  targetCategoryIds: ["c-beer"],
  schedule: schedule([FRI], "16:00", "20:00"),
});

const ITEM = {
  menuItemId: "m-beer",
  categoryPath: ["c-beer"],
  priceCents: 1_000,
  now: NOW,
} as const;

function teasers(rules: readonly DiscountRule[], at: ReturnType<typeof clock> | null) {
  return upcomingOffersForItem({ ...ITEM, rules, localNow: at });
}

function badge(rules: readonly DiscountRule[], at: ReturnType<typeof clock> | null) {
  return previewItemDiscount({ ...ITEM, rules, localNow: at });
}

describe("before the window opens: a label, and no price", () => {
  it("teases the promotion with its hours", () => {
    const found = teasers([HAPPY_HOUR], clock(FRI, "14:00"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      discountId: "hh",
      name: "Happy hour",
      type: "PERCENTAGE",
      percentOffBp: 1_000,
      from: "16:00",
      to: "20:00",
    });
  });

  it("badges NOTHING at the same instant", () => {
    // The load-bearing half. A card that struck the price through at 14:00
    // would be promising a number the checkout will not honour.
    expect(badge([HAPPY_HOUR], clock(FRI, "14:00"))).toBeNull();
  });
});

describe("during the window: a price, and no label", () => {
  it("badges the discounted price", () => {
    expect(badge([HAPPY_HOUR], clock(FRI, "17:00"))).toEqual({
      discountedPriceCents: 900,
      promoLabel: "Happy hour",
    });
  });

  it("teases nothing — the badge owns the card", () => {
    // Never both: two statements about one promotion on one card is how a
    // shopper ends up unsure which of them is true.
    expect(teasers([HAPPY_HOUR], clock(FRI, "17:00"))).toEqual([]);
  });
});

describe("after the window, and on other days", () => {
  it("says nothing once the window has closed", () => {
    expect(teasers([HAPPY_HOUR], clock(FRI, "21:00"))).toEqual([]);
    expect(badge([HAPPY_HOUR], clock(FRI, "21:00"))).toBeNull();
  });

  it("says nothing on a day the promotion does not run", () => {
    // Scoped to TODAY: "das 16h às 20h" on a Thursday advertises a price the
    // shopper cannot have until tomorrow.
    expect(teasers([HAPPY_HOUR], clock(THU, "14:00"))).toEqual([]);
  });
});

describe("what is never teased", () => {
  it("a rule with no schedule", () => {
    // It cannot be "starting later": either it is running, and the badge
    // speaks, or its campaign has not opened, which is a date and not an hour.
    const plain = percentRule(10, {
      id: "plain",
      scope: "CATEGORY",
      targetCategoryIds: ["c-beer"],
    });
    expect(teasers([plain], clock(FRI, "14:00"))).toEqual([]);
  });

  it("a coupon promotion the buyer has not typed", () => {
    const coupon = { ...HAPPY_HOUR, trigger: "CODE" as const, code: "HAPPY" };
    expect(teasers([coupon], clock(FRI, "14:00"))).toEqual([]);
  });

  it("an ORDER-wide promotion", () => {
    // Same exclusion the badge makes: it is not this item's offer, and teasing
    // it would put one sentence on every card in the menu.
    const orderWide = percentRule(10, {
      id: "ow",
      scope: "ORDER",
      schedule: schedule([FRI], "16:00", "20:00"),
    });
    expect(teasers([orderWide], clock(FRI, "14:00"))).toEqual([]);
  });

  it("a switched-off promotion", () => {
    expect(teasers([{ ...HAPPY_HOUR, active: false }], clock(FRI, "14:00"))).toEqual([]);
  });

  it("a promotion whose campaign has ended", () => {
    const over = { ...HAPPY_HOUR, endsAt: new Date("2026-03-01T00:00:00.000Z") };
    expect(teasers([over], clock(FRI, "14:00"))).toEqual([]);
  });

  it("a promotion whose campaign has not opened", () => {
    const later = { ...HAPPY_HOUR, startsAt: new Date("2026-06-01T00:00:00.000Z") };
    expect(teasers([later], clock(FRI, "14:00"))).toEqual([]);
  });

  it("an exhausted promotion", () => {
    const spent = { ...HAPPY_HOUR, usageLimit: 10, usageCount: 10 };
    expect(teasers([spent], clock(FRI, "14:00"))).toEqual([]);
  });

  it("a promotion that does not reach this item", () => {
    const elsewhere = percentRule(10, {
      id: "food",
      scope: "CATEGORY",
      targetCategoryIds: ["c-food"],
      schedule: schedule([FRI], "16:00", "20:00"),
    });
    expect(teasers([elsewhere], clock(FRI, "14:00"))).toEqual([]);
  });

  it("anything at all when the host resolved no clock", () => {
    // The badge fails OPEN on an unresolved timezone (a rule keeps firing); the
    // teaser fails CLOSED (it says nothing). Opposite directions, and both are
    // the cautious one: never withhold a price a shopper has earned, never
    // promise an hour we cannot name.
    expect(teasers([HAPPY_HOUR], null)).toEqual([]);
  });
});

describe("several promotions on one card", () => {
  it("returns each, in the evaluator's canonical order", () => {
    const second = percentRule(20, {
      id: "zz",
      name: "Segunda promo",
      scope: "ITEM",
      targetMenuItemIds: ["m-beer"],
      schedule: schedule([FRI], "18:00", "19:00"),
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const found = teasers([HAPPY_HOUR, second], clock(FRI, "10:00"));
    expect(found.map((offer) => offer.discountId)).toEqual(["hh", "zz"]);
  });

  it("reports the EARLIEST window of a promotion with several today", () => {
    const twice = {
      ...HAPPY_HOUR,
      schedule: {
        windows: [
          { days: [TUE], from: "18:00", to: "20:00" },
          { days: [TUE], from: "12:00", to: "14:00" },
        ],
      },
    };
    expect(teasers([twice], clock(TUE, "10:00"))[0]?.from).toBe("12:00");
  });
});
