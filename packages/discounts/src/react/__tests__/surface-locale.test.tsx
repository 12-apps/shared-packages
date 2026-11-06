// @vitest-environment jsdom
// The surface's chunks, warmed before the test starts.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { render, screen } from "@testing-library/react";
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
 * FUT-4482, review round 8. B1: a bare `DiscountsSurface` decides the language
 * of an older pack's missing sentences from its `locale` prop, then from its
 * formatters' `locale` — both steps pinned against a pt-BR pack, whose own
 * words would otherwise pick pt-BR. N1: a declared `form.calendar.locale` in
 * POSIX spelling reaches the calendar as a BCP-47 tag.
 */

const SURFACE_LOADED = { timeout: 10_000 };

/** A host's pt-BR pack from before this branch: the new keys left out. */
function olderPack(pack: DiscountsWebCopy): DiscountsWebCopy {
  const without = <T extends object>(group: T, keys: readonly string[]): T =>
    Object.fromEntries(Object.entries(group).filter(([key]) => !keys.includes(key))) as T;
  return {
    ...pack,
    window: without(pack.window, ["daysUnknown", "daysUnknownList", "daysUnknownForm", "daysUnknownBoxes", "daysUnknownPaused"]),
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
  datesLocked: true,
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
function noLocaleFormatters(): DiscountsFormatters {
  const { money, percent, date, parseDecimal, toInput } = createFormatters("pt-BR", "BRL");
  return { money, percent, date, parseDecimal, toInput };
}

function mountSurface(formatters: DiscountsFormatters, locale?: string): void {
  render(
    <MemoryRouter initialEntries={["/discounts"]}>
      <DiscountsSurface
        api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
        copy={olderPack(PT_BR_DISCOUNTS_WEB_COPY)}
        formatters={formatters}
        {...(locale === undefined ? {} : { locale })}
        wholeDays
        currencyField={({ name, label }) => <Fields.TextField name={name} label={label} />}
        onError={() => {}}
      />
    </MemoryRouter>,
  );
}

async function listNotice(): Promise<string> {
  return (await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED)).textContent ?? "";
}

describe("DiscountsSurface's language for an older pt-BR pack (B1)", () => {
  it("takes its locale prop: en-US fills the missing sentences in English", async () => {
    mountSurface(noLocaleFormatters(), "en-US");
    expect(await listNotice()).toContain(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknownList);
  });

  it("with no prop, takes the formatters' locale", async () => {
    mountSurface(createFormatters("en-US", "BRL"));
    expect(await listNotice()).toContain(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknownList);
  });
});

describe("a declared calendar locale in POSIX spelling (N1)", () => {
  const older = olderPack(PT_BR_DISCOUNTS_WEB_COPY);

  it("reaches the calendar as a BCP-47 tag, which toLocaleDateString accepts", () => {
    const filled = completeWebCopy({ ...older, form: { ...older.form, calendar: { locale: "pt_BR" } } });
    expect(filled.form.calendar.locale).toBe("pt-BR");
    expect(() => new Date(0).toLocaleDateString(filled.form.calendar.locale)).not.toThrow();
  });

  it("normalises it on an otherwise complete pack too", () => {
    const complete = PT_BR_DISCOUNTS_WEB_COPY;
    const filled = completeWebCopy({ ...complete, form: { ...complete.form, calendar: { ...complete.form.calendar, locale: "pt_BR" } } });
    expect(filled.form.calendar.locale).toBe("pt-BR");
  });
});
