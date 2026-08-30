// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ComboRequirement } from "../../engine/types";
import { toWriteBody, type DiscountFormPayload } from "../api";
import { blankSlot, ComboSlotBuilder, comboUnits } from "../combo-slot-builder";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * Authoring a combo (FUT-268) — the half of the promotions surface that shipped
 * able to READ a combo and unable to write one.
 *
 * The three offers below are the ones a merchant actually asks for, and the
 * cases are named after them rather than after the code path, because that is
 * what makes a regression legible: "leve 3 pague 2 stopped working" is a bug
 * report, "the FREE_UNITS branch of checkValue" is not.
 *
 * The builder is a CONTROLLED component — the form owns the groups — so each
 * case here holds the state the form would and asserts on what came back out.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

/** Render the builder with a spy for `onChange`, and hand both back. */
function renderBuilder(initial: readonly ComboRequirement[]) {
  const onChange = vi.fn();
  render(
    <ComboSlotBuilder slots={initial} groups={STORY_GROUPS} copy={copy} onChange={onChange} />,
  );
  return { onChange };
}

/** The last value a spy was called with, typed. */
function lastSlots(onChange: ReturnType<typeof vi.fn>): ComboRequirement[] {
  const calls = onChange.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("expected onChange to have been called");
  return call[0] as ComboRequirement[];
}

function payload(overrides: Partial<DiscountFormPayload> = {}): DiscountFormPayload {
  return {
    name: "Combo",
    type: "PERCENTAGE",
    percentOff: "",
    amountOff: "",
    bundlePrice: "",
    freeUnits: "",
    maxComboApplications: "",
    scope: "COMBO",
    trigger: "AUTOMATIC",
    code: "",
    startsAt: "",
    endsAt: "",
    minSubtotal: "",
    usageLimit: "",
    perBuyerLimit: "",
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    comboRequirements: [],
    schedule: null,
    ...overrides,
  };
}

/** "2 refrigerantes, 2 hambúrgueres e 2 batatas", as the builder stores it. */
const THREE_GROUPS: ComboRequirement[] = [
  { categoryIds: ["c-sodas"], menuItemIds: [], quantity: 2 },
  { categoryIds: [], menuItemIds: ["m-burger"], quantity: 2 },
  { categoryIds: [], menuItemIds: ["m-fries"], quantity: 2 },
];

describe("building the groups", () => {
  it("B1: starts empty, and says so rather than showing a group nobody added", async () => {
    renderBuilder([]);

    expect(screen.getByTestId("combo-slots-empty")).toBeTruthy();
    // There is nothing to read back yet, so the summary line is not rendered.
    await waitFor(() => expect(screen.queryByTestId("combo-summary")).toBeNull());
  });

  it("B2: appends a group of one, which is the smallest thing an operator can mean", () => {
    const { onChange } = renderBuilder([]);

    fireEvent.click(screen.getByTestId("combo-add-slot"));

    expect(lastSlots(onChange)).toEqual([{ quantity: 1, categoryIds: [], menuItemIds: [] }]);
  });

  it("B3: keeps the groups an operator already built when appending", () => {
    const { onChange } = renderBuilder(THREE_GROUPS);

    fireEvent.click(screen.getByTestId("combo-add-slot"));

    expect(lastSlots(onChange)).toHaveLength(4);
    expect(lastSlots(onChange).slice(0, 3)).toEqual(THREE_GROUPS);
  });

  it("B4: removes the group whose control was pressed, not the last one", () => {
    const { onChange } = renderBuilder(THREE_GROUPS);

    fireEvent.click(screen.getByTestId("combo-slot-1-remove"));

    expect(lastSlots(onChange)).toEqual([THREE_GROUPS[0], THREE_GROUPS[2]]);
  });

  it("B5: names the position in the remove control, so three of them are tellable apart", () => {
    renderBuilder(THREE_GROUPS);

    // 1-based: an operator counts from 1, and `position` is the array index.
    expect(screen.getByLabelText("Remover o grupo 2")).toBeTruthy();
  });

  it("B6: edits one group's quantity and leaves its siblings alone", () => {
    const { onChange } = renderBuilder(THREE_GROUPS);

    fireEvent.change(screen.getByTestId("combo-slot-2-quantity"), { target: { value: "3" } });

    expect(lastSlots(onChange)).toEqual([
      THREE_GROUPS[0],
      THREE_GROUPS[1],
      { categoryIds: [], menuItemIds: ["m-fries"], quantity: 3 },
    ]);
  });

  it("B7: reads the offer back, because a mistyped quantity is invisible otherwise", () => {
    renderBuilder(THREE_GROUPS);

    expect(screen.getByTestId("combo-summary").textContent).toContain("6");
  });

  it("B8: refuses a group naming nothing — it would save and fire on nothing", () => {
    renderBuilder([blankSlot()]);

    expect(screen.getByTestId("combo-slot-0-message").textContent).toBe(
      copy.form.comboSlotTargetRequired,
    );
  });

  it("B9: accepts a group naming only categories — the pickers are a union, not a choice", async () => {
    renderBuilder([{ categoryIds: ["c-sodas"], menuItemIds: [], quantity: 2 }]);

    await waitFor(() => expect(screen.queryByTestId("combo-slot-0-message")).toBeNull());
  });

  it("B10: offers every registered collection inside one group", () => {
    renderBuilder(THREE_GROUPS);

    // The two ids differ in shape because the two CONTROLS do: a nesting
    // collection gets `CategorySelect`, which hangs the test id on its trigger,
    // and a flat one gets the multi-select. That difference is the reason both
    // callers share one module instead of each rendering its own picker.
    expect(screen.getByTestId("combo-slot-0-categories-trigger")).toBeTruthy();
    expect(screen.getByTestId("combo-slot-0-products")).toBeTruthy();
  });
});

describe("what one application takes out of the cart", () => {
  it("B11: adds the groups' quantities, which is the bound freeUnits is checked against", () => {
    expect(comboUnits(THREE_GROUPS)).toBe(6);
  });

  it("B12: treats a half-typed quantity as zero rather than as NaN", () => {
    // A cleared number input reads as "", which `Number("")` makes 0 but
    // `Number("x")` makes NaN — and NaN would poison the whole sum and the
    // message built from it.
    expect(comboUnits([{ categoryIds: [], menuItemIds: ["m"], quantity: Number.NaN }])).toBe(0);
  });
});

describe("the three offers, on the wire", () => {
  it("B13: a fixed price for the group sends bundlePriceCents and nothing else", () => {
    const body = toWriteBody(
      payload({ type: "BUNDLE_PRICE", bundlePrice: "25,00", comboRequirements: THREE_GROUPS }),
      formatters,
    );

    expect(body.bundlePriceCents).toBe(2_500);
    expect(body.percentOffBp).toBeNull();
    expect(body.amountOffCents).toBeNull();
    expect(body.freeUnits).toBeNull();
  });

  it("B14: leve 3 pague 2 sends freeUnits and the one group it counts", () => {
    const body = toWriteBody(
      payload({
        type: "FREE_UNITS",
        freeUnits: "1",
        comboRequirements: [{ categoryIds: [], menuItemIds: ["m-burger"], quantity: 3 }],
      }),
      formatters,
    );

    expect(body.freeUnits).toBe(1);
    expect(body.bundlePriceCents).toBeNull();
    expect(body.comboRequirements).toEqual([
      { categoryIds: [], menuItemIds: ["m-burger"], quantity: 3 },
    ]);
  });

  it("B15: the same group at a rate sends percentOffBp — a reward is the TYPE", () => {
    const body = toWriteBody(
      payload({ type: "PERCENTAGE", percentOff: "20", comboRequirements: THREE_GROUPS }),
      formatters,
    );

    expect(body.percentOffBp).toBe(2_000);
    expect(body.bundlePriceCents).toBeNull();
    expect(body.comboRequirements).toEqual(THREE_GROUPS);
  });

  it("B16: carries the per-cart cap, and only at COMBO scope", () => {
    const combo = toWriteBody(
      payload({ maxComboApplications: "2", percentOff: "20", comboRequirements: THREE_GROUPS }),
      formatters,
    );
    const order = toWriteBody(
      payload({ scope: "ORDER", maxComboApplications: "2", percentOff: "20" }),
      formatters,
    );

    expect(combo.maxComboApplications).toBe(2);
    expect(order.maxComboApplications).toBeNull();
  });

  it("B17: a blank cap is null, never zero — zero would mean the combo never applies", () => {
    const body = toWriteBody(
      payload({ percentOff: "20", comboRequirements: THREE_GROUPS }),
      formatters,
    );

    expect(body.maxComboApplications).toBeNull();
  });

  it("B18: drops the groups when the scope moved off COMBO", () => {
    // Otherwise a rule an operator re-scoped to ORDER goes on being matched as
    // a combo by a screen that no longer shows one.
    const body = toWriteBody(
      payload({ scope: "ORDER", percentOff: "20", comboRequirements: THREE_GROUPS }),
      formatters,
    );

    expect(body.comboRequirements).toEqual([]);
  });
});
