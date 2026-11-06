// @vitest-environment jsdom
// The surface's chunks, warmed before the test starts.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import type { DiscountsWebCopy } from "../copy";
import { completeWebCopy } from "../copy-fallback";
import { DiscountsSurface } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters, type DiscountsFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * FUT-4482, review round 7: the language a host pack's missing sentences are
 * filled in from. B2: a bare `DiscountsSurface`, with a host's own formatters
 * (no `locale`, as `DiscountsFormatters` always allowed) and a pt-BR pack from
 * before the calendar block, filled its sentences in English. N2: a POSIX tag,
 * a host language the package has no pack for, and a `pt` other than `pt-BR`.
 */

const SURFACE_LOADED = { timeout: 10_000 };

/** A host's pack from before this branch: the new keys left out. */
function olderPack(pack: DiscountsWebCopy): DiscountsWebCopy {
  const without = <T extends object>(group: T, keys: readonly string[]): T =>
    Object.fromEntries(Object.entries(group).filter(([key]) => !keys.includes(key))) as T;
  return {
    ...pack,
    window: without(pack.window, [
      "daysUnknown",
      "daysUnknownList",
      "daysUnknownForm",
      "daysUnknownBoxes",
      "daysUnknownPaused",
      "openTimeZone",
    ]),
    form: without(pack.form, ["calendar", "endsBeforeStartDay"]),
  };
}

const UNKNOWN: DiscountWireRecord = {
  id: "d-1",
  name: "Semana do hambúrguer",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  startsAt: "2026-11-09T15:00:00.000Z",
  endsAt: "2026-11-20T15:00:00.000Z",
  daysUnknown: true,
  minSubtotalCents: null,
  usageLimit: null,
  perBuyerLimit: null,
  usageCount: 0,
  stackable: true,
  active: true,
  categoryIds: [],
  menuItemIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
};

const transport: DiscountsTransport = {
  get: <T,>(url: string): Promise<T> =>
    url.endsWith("/targets")
      ? Promise.resolve({ data: STORY_GROUPS } as T)
      : Promise.resolve({
          data: [UNKNOWN],
          pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
        } as T),
  send: <T,>() => Promise.resolve({ ok: true as const, data: { id: "d-1" } as T }),
};

/** A host's own formatters, written before they had a `locale`. */
function hostFormatters(): DiscountsFormatters {
  const full = createFormatters("pt-BR", "BRL");
  return {
    money: full.money,
    percent: full.percent,
    date: full.date,
    parseDecimal: full.parseDecimal,
    toInput: full.toInput,
  };
}

describe("a bare DiscountsSurface with a pt-BR pack from before the calendar block (B2)", () => {
  it("says the list and the calendar in Portuguese with no locale anywhere", async () => {
    const formatters = hostFormatters();
    expect(formatters.locale).toBeUndefined();
    render(
      <MemoryRouter initialEntries={["/discounts"]}>
        <DiscountsSurface
          api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
          copy={olderPack(PT_BR_DISCOUNTS_WEB_COPY)}
          formatters={formatters}
          wholeDays
          currencyField={({ name, label }) => <Fields.TextField name={name} label={label} />}
          onError={() => {}}
        />
      </MemoryRouter>,
    );
    const notice = await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED);
    expect(notice.textContent).toContain("Datas indisponíveis");
    const kebab = await screen.findAllByTestId(`discount-actions-${UNKNOWN.id}`, undefined, SURFACE_LOADED);
    fireEvent.click(within(kebab[0]!).queryByRole("button") ?? kebab[0]!);
    fireEvent.click(await screen.findByTestId("discount-action-edit"));
    const period = await screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
    expect(within(period).getByTestId("discount-period-unavailable").textContent).toBe(
      PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknownBoxes,
    );
    const month = within(within(period).getByTestId("calendar-month-0")).getByRole("heading").textContent ?? "";
    expect(month).toMatch(/^Novembro de 2026$/u);
  });

  it("takes an explicit locale over the pack's own words", () => {
    const filled = completeWebCopy(olderPack(PT_BR_DISCOUNTS_WEB_COPY), "en-US");
    expect(filled.window.daysUnknown).toBe(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknown);
  });

  it("still fills an English pack in English", () => {
    const filled = completeWebCopy(olderPack(EN_US_DISCOUNTS_WEB_COPY));
    expect(filled.window.daysUnknown).toBe(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknown);
    expect(filled.form.calendar.locale).toBe("en-US");
  });
});

describe("completeWebCopy's host tag (N2)", () => {
  const older = olderPack(PT_BR_DISCOUNTS_WEB_COPY);

  it("reads the POSIX pt_BR as pt-BR", () => {
    const filled = completeWebCopy(olderPack(EN_US_DISCOUNTS_WEB_COPY), "pt_BR");
    expect(filled.window.daysUnknown).toBe(PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknown);
    expect(filled.form.calendar.locale).toBe("pt-BR");
  });

  it("writes the months in the host's own tag while its sentences fall back to en-US", () => {
    const filled = completeWebCopy(older, "es-ES");
    expect(filled.form.calendar.locale).toBe("es-ES");
    expect(filled.window.daysUnknown).toBe(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknown);
    expect(filled.form.calendar.nextMonth).toBe(EN_US_DISCOUNTS_WEB_COPY.form.calendar.nextMonth);
  });

  it("gives any pt tag the pt-BR sentences and keeps the tag for the months", () => {
    const filled = completeWebCopy(olderPack(EN_US_DISCOUNTS_WEB_COPY), "pt-PT");
    expect(filled.window.daysUnknown).toBe(PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknown);
    expect(filled.form.calendar.locale).toBe("pt-PT");
  });

  it("keeps a calendar language the pack declares", () => {
    const filled = completeWebCopy({ ...older, form: { ...older.form, calendar: { locale: "pt-BR" } } }, "es-ES");
    expect(filled.form.calendar.locale).toBe("pt-BR");
  });
});
