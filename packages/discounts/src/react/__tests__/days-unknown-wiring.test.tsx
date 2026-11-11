// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { describe, expect, expectTypeOf, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import type { DiscountWireRecord } from "../api";
import { createWebDiscounts } from "../create-web-discounts";
import { DaysUnknownMarker, type DiscountsTimeZoneSettings } from "../days-unknown-notice";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";
import { reach } from "./step-form-shim";

/**
 * FUT-4482, review round 5 (B3, N5): what the round-four tests left unasserted.
 * The marker under a row's name is hidden from `lg` up — jsdom runs no media
 * queries, so the rule itself is read out of the styles emotion inserted — the
 * standalone form passes the host's time-zone link through, and the link's
 * config is one shape or the other, never both.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;

/** The `display` one rule gives a class: outside any media block, or inside `@media <condition>`. */
function displayOf(cls: string, condition?: string): string | undefined {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      const scoped = rule instanceof CSSMediaRule ? rule : null;
      if ((scoped === null) !== (condition === undefined)) continue;
      if (scoped !== null && scoped.conditionText.replace(/\s+/gu, "") !== condition) continue;
      const inner = scoped === null ? [rule] : Array.from(scoped.cssRules);
      for (const style of inner) {
        if (style instanceof CSSStyleRule && style.selectorText === `.${cls}` && style.style.display !== "") {
          return style.style.display;
        }
      }
    }
  }
  return undefined;
}

describe("the marker under a row's name (B3)", () => {
  it("shows below lg and hides from lg up, by its own media rule", () => {
    render(<DaysUnknownMarker copy={copy} />);
    const marker = reach("discount-days-unknown-marker");
    const cls = Array.from(marker.classList).find((name) => name.startsWith("css-"));
    expect(cls).toBeDefined();
    // MUI's default lg is 1200px; `display: { xs: "block", lg: "none" }`.
    // MUI writes even `xs` as a media block, from 0px.
    expect(displayOf(cls!)).toBeUndefined();
    expect(displayOf(cls!, "(min-width:0px)")).toBe("block");
    expect(displayOf(cls!, "(min-width:1200px)")).toBe("none");
    expect(displayOf(cls!, "(min-width:900px)")).toBeUndefined();
  });
});

const UNKNOWN: DiscountWireRecord = {
  id: "d-1",
  name: "Semana",
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
  get: <T,>(): Promise<T> => Promise.resolve({ data: [] } as T),
  send: () => Promise.resolve({ ok: true, data: null as never }),
};

describe("the standalone DiscountForm (B3)", () => {
  it("passes the host's time-zone link through to the days-unknown notice", () => {
    const { DiscountForm } = createWebDiscounts({
      apiBase: "/api/admin/loja",
      copy,
      locale: "pt-BR",
      currency: "BRL",
      currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
      onError: () => {},
      transport,
      wholeDays: true,
      timeZoneSettings: { href: "/admin/loja/config#fuso" },
    });
    render(<DiscountForm editing={UNKNOWN} groups={[]} onSaved={() => {}} />);
    const notice = reach("discount-days-unknown");
    expect(within(notice).getByRole("link", { name: copy.window.openTimeZone }).getAttribute("href")).toBe(
      "/admin/loja/config#fuso",
    );
  });
});

describe("DiscountsTimeZoneSettings (N5)", () => {
  it("is a link or a handler, never both and never neither", () => {
    expectTypeOf<{ href: string }>().toMatchTypeOf<DiscountsTimeZoneSettings>();
    expectTypeOf<{ onClick: () => void }>().toMatchTypeOf<DiscountsTimeZoneSettings>();
    // @ts-expect-error — both at once: which one wins would be a guess.
    const both: DiscountsTimeZoneSettings = { href: "/fuso", onClick: () => {} };
    // @ts-expect-error — neither: a notice link to nowhere.
    const neither: DiscountsTimeZoneSettings = {};
    expect([both, neither]).toHaveLength(2);
  });
});
