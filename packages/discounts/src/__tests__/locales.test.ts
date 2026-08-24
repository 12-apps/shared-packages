import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import { MIN_SUBTOTAL_TOKEN } from "../engine/rejection-copy";
import {
  DISCOUNT_REJECTION_COPY,
  DISCOUNTS_SERVER_COPY,
  DISCOUNTS_WEB_COPY,
} from "../locales";

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, and the three properties of this surface a translation could break
 * without breaking a type.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe("the locale packs", () => {
  it("speak both languages the same way", () => {
    assertLocaleParity("DISCOUNT_REJECTION_COPY", DISCOUNT_REJECTION_COPY);
    assertLocaleParity("DISCOUNTS_SERVER_COPY", DISCOUNTS_SERVER_COPY);
    assertLocaleParity("DISCOUNTS_WEB_COPY", DISCOUNTS_WEB_COPY);
  });

  it("keeps the four schedule rejections indistinguishable", () => {
    // The difference between "switched off", "not started" and "expired" only
    // leaks how the merchant schedules promotions, and a shopper could not act
    // on it either way. Four distinct English sentences would be a disclosure
    // the Portuguese does not make.
    for (const copy of Object.values(DISCOUNT_REJECTION_COPY)) {
      const schedule = [copy.UNKNOWN_CODE, copy.INACTIVE, copy.NOT_STARTED, copy.EXPIRED];
      expect(new Set(schedule).size).toBe(1);
      // …and the one place the coarsening stops: a buyer one item short can
      // finish the bundle, so this has to say something else.
      expect(copy.COMBO_NOT_MATCHED).not.toBe(copy.UNKNOWN_CODE);
    }
  });

  it("carries the minimum-order token rather than a number", () => {
    for (const copy of Object.values(DISCOUNT_REJECTION_COPY)) {
      expect(copy.MIN_SUBTOTAL_NOT_MET).toContain(MIN_SUBTOTAL_TOKEN);
    }
  });

  it("keeps every substitution token the surface fills in", () => {
    // `fill()` replaces these; a renamed token renders its own placeholder to
    // a user and nothing else notices.
    for (const copy of Object.values(DISCOUNTS_WEB_COPY)) {
      expect(copy.window.from).toContain("{date}");
      expect(copy.window.between).toContain("{from}");
      expect(copy.window.between).toContain("{to}");
      expect(copy.combo.slot).toContain("{position}");
      expect(copy.combo.summary).toContain("{units}");
      expect(copy.combo.summary).toContain("{groups}");
      expect(copy.targets.pick).toContain("{collection}");
      expect(copy.actions.deleteManyTitle).toContain("{count}");
      expect(copy.card.withCode).toContain("{code}");
      expect(copy.form.freeUnitsExceedCombo).toContain("{units}");
      expect(copy.form.freeUnitsExceedCombo).toContain("{max}");
    }
  });

  it("keeps the wire date format out of the translation", () => {
    // The route parses YYYY-MM-DD whichever language reports the failure.
    // Naming any other order sends an operator to type what the endpoint
    // rejects.
    for (const copy of Object.values(DISCOUNTS_SERVER_COPY)) {
      expect(copy.invalidDate.toUpperCase()).toMatch(/(YYYY|AAAA)-MM-DD/);
    }
  });
});
