// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { initialValues } from "../discount-form-values";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters, formatWindow } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { reach } from "./step-form-shim";

/**
 * FUT-4482, review round 3 (B2): a rule written in the store's zone that the
 * server cannot place now (the zone is misconfigured) arrives `daysUnknown`,
 * with no `startsOn` / `endsOn`. The form and the list must not fall back to
 * the instants: a Tokyo rule for 10/11 is stored as 2026-11-09T15:00Z, and
 * slicing or formatting that in UTC says 09/11.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

const TOKYO_UNKNOWN: DiscountWireRecord = {
  id: "d-1",
  name: "Semana",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  // 10/11 to 20/11, whole days in Asia/Tokyo.
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

describe("a rule whose days the server cannot place", () => {
  it("opens the form with both boxes empty, never the UTC-sliced instants", () => {
    const values = initialValues(TOKYO_UNKNOWN, formatters);
    expect(values.startsAt).toBe("");
    expect(values.endsAt).toBe("");
  });

  it("says so in the list in place of the period, in both packs", () => {
    // Review round 4: the cell says the short words; the cause is said once,
    // above the list (days-unknown-round-four.test.tsx).
    expect(formatWindow(TOKYO_UNKNOWN, formatters, copy)).toBe("Datas indisponíveis");
    expect(formatWindow(TOKYO_UNKNOWN, formatters, EN_US_DISCOUNTS_WEB_COPY)).toBe(
      EN_US_DISCOUNTS_WEB_COPY.window.daysUnknown,
    );
  });

  it("shows the notice above the empty boxes in the edit form", () => {
    const transport: DiscountsTransport = {
      get: <T,>(): Promise<T> => Promise.resolve({ data: STORY_GROUPS } as T),
      send: vi.fn(),
    };
    render(
      <DiscountForm
        api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
        copy={copy}
        formatters={formatters}
        currencyField={({ name, label }) => <input name={name} aria-label={label} readOnly />}
        groups={STORY_GROUPS}
        editing={TOKYO_UNKNOWN}
        onSaved={vi.fn()}
        onError={() => {}}
        wholeDays
      />,
    );
    expect(reach("discount-days-unknown").textContent).toContain(copy.window.daysUnknownForm);
    expect((reach("total-form-field-startsAt") as HTMLInputElement).value).toBe("");
    expect((reach("total-form-field-endsAt") as HTMLInputElement).value).toBe("");
  });

  it("keeps the UTC instants' own days for a server that counts no whole days (no flag, no days)", () => {
    const plain = { ...TOKYO_UNKNOWN, daysUnknown: undefined, startsAt: "2026-11-10T00:00:00.000Z", endsAt: null };
    expect(initialValues(plain, formatters).startsAt).toBe("2026-11-10");
    expect(formatWindow(plain, formatters, copy)).toBe("A partir de 10/11/2026");
  });
});
