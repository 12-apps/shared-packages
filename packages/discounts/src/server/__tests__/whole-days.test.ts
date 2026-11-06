import { describe, expect, it } from "vitest";

import { evaluateCart, line, rule } from "../../engine/__tests__/fixtures";
import type { DiscountRule } from "../../engine/types";
import { windowCalendarDays, wholeDayWindow } from "../../timezone";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import {
  DiscountValidationError,
  toDiscountScalars,
  type DiscountScalars,
  type DiscountWriteInput,
} from "../validate";

/**
 * FUT-4482 (owner, 2026-11-06): the days an operator chooses count WHOLE, on
 * the STORE's clock. Início 10/11 applies from 00:00 on 10/11 and Término 20/11
 * until the last instant of 20/11, both in the store's zone.
 *
 * Before, `YYYY-MM-DD` became UTC midnight and the engine treated `endsAt` as
 * exclusive, so in São Paulo (UTC−3) Término 20/11 stopped at 21:00 on 19/11
 * and Início 10/11 started at 21:00 on 09/11. The engine is unchanged and still
 * half-open: what changes is WHICH instants the write path stores.
 */

const SP = "America/Sao_Paulo";

function input(overrides: Partial<DiscountWriteInput> = {}): DiscountWriteInput {
  return {
    name: "Semana do hambúrguer",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    bundlePriceCents: null,
    freeUnits: null,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    comboRequirements: [],
    maxComboApplications: null,
    ...overrides,
  };
}

/** The rule the engine would read back for a stored write. */
function ruleOf(scalars: DiscountScalars): DiscountRule {
  return rule({ id: "d1", startsAt: scalars.startsAt, endsAt: scalars.endsAt });
}

/** Does the rule take money off a one-line cart at `now`? */
function appliesAt(scalars: DiscountScalars, now: string): boolean {
  const result = evaluateCart({ rules: [ruleOf(scalars)], lines: [line({ lineId: "l1" })], now: new Date(now) });
  return result.applied.some((applied) => applied.discountId === "d1");
}

/** What `run` threw, or undefined. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const scalarsIn = (overrides: Partial<DiscountWriteInput>, timeZone?: string): DiscountScalars =>
  toDiscountScalars(input(overrides), PT_BR_DISCOUNTS_SERVER_COPY, timeZone ? { timeZone } : {});

describe("whole days in the store's zone (FUT-4482)", () => {
  it("stores Início as 00:00 of that day and Término as 00:00 of the day AFTER, in São Paulo", () => {
    const scalars = scalarsIn({ startsAt: "2026-11-10", endsAt: "2026-11-20" }, SP);
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("keeps Término 20/11 running at 23:30 local, and stops it at 00:00 on 21/11", () => {
    const scalars = scalarsIn({ endsAt: "2026-11-20" }, SP);
    // 23:30 on 20/11 in São Paulo is 02:30Z on 21/11.
    expect(appliesAt(scalars, "2026-11-21T02:30:00.000Z")).toBe(true);
    // 00:00 on 21/11 in São Paulo is 03:00Z.
    expect(appliesAt(scalars, "2026-11-21T03:00:00.000Z")).toBe(false);
  });

  it("does not start Início 10/11 at 21:30 local on 09/11, and starts it at 00:00 on 10/11", () => {
    const scalars = scalarsIn({ startsAt: "2026-11-10" }, SP);
    // 21:30 on 09/11 in São Paulo is 00:30Z on 10/11 — inside the old UTC day.
    expect(appliesAt(scalars, "2026-11-10T00:30:00.000Z")).toBe(false);
    expect(appliesAt(scalars, "2026-11-10T03:00:00.000Z")).toBe(true);
  });

  it("accepts Início = Término as a one-day promotion, whole on the store's clock", () => {
    const scalars = scalarsIn({ startsAt: "2026-11-20", endsAt: "2026-11-20" }, SP);
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(appliesAt(scalars, "2026-11-20T03:00:00.000Z")).toBe(true);
    expect(appliesAt(scalars, "2026-11-21T02:59:59.999Z")).toBe(true);
  });

  it("still refuses Término before Início, on Término, with the whole-day sentence", () => {
    const caught = thrownBy(() => scalarsIn({ startsAt: "2026-11-20", endsAt: "2026-11-19" }, SP));
    expect(caught).toBeInstanceOf(DiscountValidationError);
    expect((caught as DiscountValidationError).field).toBe("endsAt");
    expect((caught as DiscountValidationError).message).toBe(PT_BR_DISCOUNTS_SERVER_COPY.endsBeforeStartDay);
  });

  it("refuses a day no calendar has, naming the field", () => {
    expect(() => scalarsIn({ startsAt: "2026-02-31" }, SP)).toThrow(PT_BR_DISCOUNTS_SERVER_COPY.invalidDate);
  });

  it("works east of Greenwich too: Tokyo's 10/11 starts at 15:00Z on 09/11", () => {
    const scalars = scalarsIn({ startsAt: "2026-11-10", endsAt: "2026-11-10" }, "Asia/Tokyo");
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-09T15:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });

  it("refuses dates on a zone the runtime does not know, rather than guessing UTC", () => {
    expect(() => scalarsIn({ startsAt: "2026-11-10" }, "Mars/Olympus_Mons")).toThrow(
      PT_BR_DISCOUNTS_SERVER_COPY.datesNeedKnownZone,
    );
  });

  it("places an open window on an unknown zone: no dates need no clock", () => {
    expect(scalarsIn({}, "Mars/Olympus_Mons")).toMatchObject({ startsAt: null, endsAt: null, windowInZone: true });
  });

  it("with no zone, keeps today's behaviour exactly: UTC midnight, Término exclusive, equal refused", () => {
    const scalars = scalarsIn({ startsAt: "2026-11-10", endsAt: "2026-11-20" });
    expect(scalars.startsAt?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(scalars.endsAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(() => scalarsIn({ startsAt: "2026-11-10", endsAt: "2026-11-10" })).toThrow(
      PT_BR_DISCOUNTS_SERVER_COPY.endsBeforeStarts,
    );
  });
});

describe("the zone arithmetic (FUT-4482)", () => {
  it("starts a day at the instant the clocks jump when its midnight does not exist", () => {
    // Chile moves 00:00 → 01:00 on Sunday 06/09/2026: that day begins at 01:00
    // local (04:00Z), and the instant before it is still Saturday.
    const { startsAt } = wholeDayWindow("2026-09-06", null, "America/Santiago");
    expect(startsAt?.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(windowCalendarDays(new Date(startsAt!.getTime() - 1), null, "America/Santiago").startsOn).toBe(
      "2026-09-05",
    );
  });

  it("reads a stored rule back as the SAME days the operator chose", () => {
    const window = wholeDayWindow("2026-11-10", "2026-11-20", SP);
    expect(windowCalendarDays(window.startsAt, window.endsAt, SP)).toEqual({
      startsOn: "2026-11-10",
      endsOn: "2026-11-20",
    });
    // As JSON delivers them, too.
    expect(
      windowCalendarDays(window.startsAt!.toISOString(), window.endsAt!.toISOString(), SP),
    ).toEqual({ startsOn: "2026-11-10", endsOn: "2026-11-20" });
  });

  it("reads a rule stored the OLD way as the days it really runs on, never as UTC days", () => {
    // Término 20/11 stored as 20/11 00:00Z stops at 21:00 on 19/11 in São Paulo:
    // its last running day there is the 19th, and the 9th is when it starts.
    expect(
      windowCalendarDays(new Date("2026-11-10T00:00:00.000Z"), new Date("2026-11-20T00:00:00.000Z"), SP),
    ).toEqual({ startsOn: "2026-11-09", endsOn: "2026-11-19" });
  });

  it("leaves an open end open", () => {
    expect(wholeDayWindow(null, null, SP)).toEqual({ startsAt: null, endsAt: null });
    expect(windowCalendarDays(null, null, SP)).toEqual({ startsOn: null, endsOn: null });
  });
});
