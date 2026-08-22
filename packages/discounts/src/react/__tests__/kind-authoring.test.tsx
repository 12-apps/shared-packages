// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import {
  comboRewardOf,
  DISCOUNT_KINDS,
  kindOf,
  kindOptions,
  SELECTABLE_DISCOUNT_SCOPES,
  typeAndScopeFor,
} from "../form-kind";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * The KIND of promotion, and what it decides (FUT-268).
 *
 * The form used to ask two independent questions — `type` and `scope` — and
 * offer all sixteen of their combinations, most of which are not offers anybody
 * sells and several of which the write path refuses. It now asks ONE, and
 * derives the pair.
 *
 * The cases are named after what a merchant would say, because that is what
 * makes a regression legible: "the combo lost its discount field" is a bug
 * report, "the COMBO branch of RewardFields" is not.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

/** The plain text field a host without a currency mask would pass. */
function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

/** A transport that RECORDS the write, so a case can assert the payload. */
function recordingTransport(): { transport: DiscountsTransport; sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    transport: {
      get: <T,>(url: string): Promise<T> =>
        url.includes("/discounts/targets")
          ? Promise.resolve({ data: STORY_GROUPS } as T)
          : Promise.resolve({ data: [], pagination: {} } as T),
      send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
        sent.push(body);
        return Promise.resolve({ ok: true, data: null as T });
      },
    },
  };
}

function renderForm(editing: DiscountWireRecord | null) {
  const { transport, sent } = recordingTransport();
  const onSaved = vi.fn();
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={editing}
      onSaved={onSaved}
      onError={() => {}}
    />,
  );
  return { sent, onSaved };
}

/** One combo rule, as the wire hands it back. */
function comboRecord(overrides: Partial<DiscountWireRecord> = {}): DiscountWireRecord {
  return {
    id: "d-combo",
    name: "Combo lanche",
    type: "PERCENTAGE",
    percentOffBp: 1_500,
    amountOffCents: null,
    scope: "COMBO",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    comboRequirements: [
      { menuItemIds: [], categoryIds: ["c-sodas"], quantity: 2 },
      { menuItemIds: ["m-burger"], categoryIds: [], quantity: 1 },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("which kind a stored rule reads back as", () => {
  it("K1: a new promotion is a percentage — the one an operator creates most", () => {
    expect(kindOf(null)).toBe("PERCENTAGE");
  });

  it("K2: a plain rule is its own type, whatever it covers", () => {
    expect(kindOf({ type: "PERCENTAGE", scope: "ORDER" })).toBe("PERCENTAGE");
    expect(kindOf({ type: "FIXED_AMOUNT", scope: "CATEGORY" })).toBe("FIXED_AMOUNT");
    expect(kindOf({ type: "PERCENTAGE", scope: "ITEM" })).toBe("PERCENTAGE");
  });

  it("K3: a combo is a COMBO whichever of the two rewards it gives", () => {
    expect(kindOf({ type: "PERCENTAGE", scope: "COMBO" })).toBe("COMBO");
    expect(kindOf({ type: "FIXED_AMOUNT", scope: "COMBO" })).toBe("COMBO");
  });

  it("K4: leve 3 pague 2 is its own kind, not a combo with a count", () => {
    expect(kindOf({ type: "FREE_UNITS", scope: "COMBO" })).toBe("FREE_UNITS");
  });

  it("K5: a rule saved as a bundle price still reads back as one", () => {
    expect(kindOf({ type: "BUNDLE_PRICE", scope: "COMBO" })).toBe("BUNDLE_PRICE");
  });

  it("K6: a combo's reward toggle starts on whichever it was saved with", () => {
    expect(comboRewardOf({ type: "FIXED_AMOUNT" })).toBe("FIXED_AMOUNT");
    expect(comboRewardOf({ type: "PERCENTAGE" })).toBe("PERCENTAGE");
    expect(comboRewardOf(null)).toBe("PERCENTAGE");
  });
});

describe("which kinds are on offer", () => {
  it("K7: a new promotion is offered four, and a bundle price is not one", () => {
    expect(kindOptions(null)).toEqual(["PERCENTAGE", "FIXED_AMOUNT", "COMBO", "FREE_UNITS"]);
    expect(kindOptions(null)).not.toContain("BUNDLE_PRICE");
  });

  it("K8: editing a legacy bundle price grows the fifth option — on that form only", () => {
    expect(kindOptions({ type: "BUNDLE_PRICE", scope: "COMBO" })).toEqual([
      ...DISCOUNT_KINDS,
      "BUNDLE_PRICE",
    ]);
    expect(kindOptions({ type: "PERCENTAGE", scope: "ORDER" })).not.toContain("BUNDLE_PRICE");
  });

  it("K9: COMBO is not a scope an operator picks — it is what a kind means", () => {
    expect(SELECTABLE_DISCOUNT_SCOPES).toEqual(["ORDER", "CATEGORY", "ITEM"]);
  });
});

describe("what the form sends", () => {
  it("K10: a combo at a rate sends PERCENTAGE over COMBO", () => {
    expect(typeAndScopeFor({ kind: "COMBO", comboReward: "PERCENTAGE", scope: "ORDER" })).toEqual({
      type: "PERCENTAGE",
      scope: "COMBO",
    });
  });

  it("K11: the same combo at an amount sends FIXED_AMOUNT over COMBO", () => {
    expect(typeAndScopeFor({ kind: "COMBO", comboReward: "FIXED_AMOUNT", scope: "ITEM" })).toEqual({
      type: "FIXED_AMOUNT",
      scope: "COMBO",
    });
  });

  it("K12: leve 3 pague 2 is FREE_UNITS over COMBO, which is where the engine reads it", () => {
    expect(
      typeAndScopeFor({ kind: "FREE_UNITS", comboReward: "PERCENTAGE", scope: "CATEGORY" }),
    ).toEqual({ type: "FREE_UNITS", scope: "COMBO" });
  });

  it("K13: a plain kind keeps the scope the operator chose", () => {
    expect(
      typeAndScopeFor({ kind: "FIXED_AMOUNT", comboReward: "PERCENTAGE", scope: "CATEGORY" }),
    ).toEqual({ type: "FIXED_AMOUNT", scope: "CATEGORY" });
  });

  it("K14: a scope left behind by a kind switch is clamped, never sent", () => {
    // The toggle is unmounted at combo kinds, so `scope` still holds COMBO the
    // moment the operator switches back — and COMBO with no groups is a rule
    // the write path refuses.
    expect(
      typeAndScopeFor({ kind: "PERCENTAGE", comboReward: "PERCENTAGE", scope: "COMBO" }),
    ).toEqual({ type: "PERCENTAGE", scope: "ORDER" });
  });
});

describe("what the operator sees", () => {
  it("K15: the kind toggle asks the question first, in the merchant's words", () => {
    renderForm(null);
    for (const label of ["Porcentagem", "Valor fixo", "Combo", "Itens grátis"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("K16: a plain kind is asked what it covers, and is offered three scopes", () => {
    renderForm(null);
    expect(screen.getByText(copy.form.scope)).toBeTruthy();
    // "Combo" reads ONCE on this screen — as a kind. A second one would be the
    // scope toggle still offering it, which is the combination the write path
    // refuses ("preço de combo, abrangência: pedido").
    expect(screen.getAllByText("Combo")).toHaveLength(1);
    for (const scope of ["Pedido", "Categoria", "Item"]) {
      expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    }
  });

  it("K17: a combo is asked NOTHING about scope — it covers its own groups", async () => {
    renderForm(comboRecord());
    expect(screen.getByTestId("combo-slots")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(copy.form.scope)).toBeNull();
    });
  });

  it("K18: a combo's reward sits beside its number, not three screens above it", () => {
    renderForm(comboRecord());
    expect(screen.getByText(copy.form.comboReward)).toBeTruthy();
    expect(screen.getByText(copy.form.comboRewardHint)).toBeTruthy();
  });

  it("K19: leve 3 pague 2 gets its own builder, not the group list", async () => {
    renderForm(
      comboRecord({
        type: "FREE_UNITS",
        percentOffBp: null,
        freeUnits: 1,
        comboRequirements: [{ menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 }],
      }),
    );
    expect(screen.getByTestId("free-units-builder")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("combo-slots")).toBeNull();
    });
  });

  it("K20: that builder names PRODUCTS and never categories", async () => {
    renderForm(
      comboRecord({
        type: "FREE_UNITS",
        percentOffBp: null,
        freeUnits: 1,
        comboRequirements: [{ menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 }],
      }),
    );
    expect(screen.getByTestId("free-units-items")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Categorias da promoção")).toBeNull();
    });
  });

  it("K21: it reads the offer back in the words the shopper will hear", () => {
    renderForm(
      comboRecord({
        type: "FREE_UNITS",
        percentOffBp: null,
        freeUnits: 1,
        comboRequirements: [{ menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 }],
      }),
    );
    expect(screen.getByTestId("free-units-summary").textContent).toBe("Leve 3, pague 2.");
  });

  it("K22: the legacy bundle price is offered on its own form and nowhere else", () => {
    renderForm(comboRecord({ type: "BUNDLE_PRICE", percentOffBp: null, bundlePriceCents: 2_500 }));
    expect(screen.getAllByText(copy.labels.kind.BUNDLE_PRICE).length).toBeGreaterThan(0);
  });
});

describe("what it refuses", () => {
  it("K23: a combo with no groups is refused on the kind, which is on screen", async () => {
    renderForm(comboRecord({ comboRequirements: [] }));
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("discount-form-error")).toBeTruthy();
    });
    expect(screen.getByText(copy.form.comboSlotsRequired)).toBeTruthy();
  });

  it("K24: leve 3 pague 2 with no product is refused in ITS words, not the combo's", async () => {
    renderForm(
      comboRecord({ type: "FREE_UNITS", percentOffBp: null, freeUnits: 1, comboRequirements: [] }),
    );
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("discount-form-error")).toBeTruthy();
    });
    expect(screen.getAllByText(copy.form.freeUnitsTargetRequired).length).toBeGreaterThan(0);
  });

  it("K25: a valid combo reaches the wire as the pair the engine reads", async () => {
    const { sent, onSaved } = renderForm(comboRecord());
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(sent[0]).toMatchObject({
      type: "PERCENTAGE",
      scope: "COMBO",
      percentOffBp: 1_500,
      amountOffCents: null,
      bundlePriceCents: null,
      freeUnits: null,
    });
  });
});
