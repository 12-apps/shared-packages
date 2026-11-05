// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFormContext } from "@12-apps/ui/form/total-form";

import type { ComboRequirement } from "../../engine/types";
import {
  createDiscountsApiClient,
  type DiscountWireRecord,
  type WireTargetGroup,
} from "../api";
import { comboPreviewOf, type ComboRewardValue } from "../combo-preview";
import {
  comboPreviewLines,
  type ComboPreviewLayout,
} from "../combo-preview-lines";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import {
  comboRewardOf,
  COMBO_REWARDS,
  kindOf,
  typeAndScopeFor,
} from "../form-kind";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";

/**
 * "X marmitas por um preço fechado" (FUT-4417).
 *
 * A combo's reward used to be a discount off its items and nothing else; the
 * engine priced `BUNDLE_PRICE` all along but the form only kept it alive for
 * old rules. These cases are the third choice, "Preço fechado", and the "Como
 * fica no carrinho" preview the approved prototype (option A) draws beside it,
 * on the demo store's own marmitas: Frango R$ 26,90, Vegetariana R$ 27,90,
 * Carne R$ 29,90, Peixe R$ 31,90 — five of them sum to R$ 134,50 … R$ 159,50.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
/** `Intl` writes a no-break space after "R$"; the prototype's copy is compared with a plain one. */
const plain = (text: string | null | undefined): string | null =>
  text === null || text === undefined ? null : text.replace(/\u00a0/g, " ");

const MARMITAS: WireTargetGroup[] = [
  {
    targetType: "CATEGORY",
    slug: "categories",
    label: "Categorias",
    nests: true,
    targets: [
      { id: "c-pratos", name: "Pratos", parentId: null },
      { id: "c-marmitas", name: "Marmitas do dia", parentId: "c-pratos" },
      { id: "c-bebidas", name: "Bebidas", parentId: null },
    ],
  },
  {
    targetType: "ITEM",
    slug: "products",
    label: "Produtos",
    nests: false,
    targets: [
      {
        id: "m-frango",
        name: "Frango grelhado",
        categoryId: "c-marmitas",
        priceRangeCents: { minCents: 2_690, maxCents: 2_690 },
      },
      {
        id: "m-veg",
        name: "Vegetariana",
        categoryId: "c-marmitas",
        priceRangeCents: { minCents: 2_790, maxCents: 2_790 },
      },
      {
        id: "m-carne",
        name: "Carne de panela",
        categoryId: "c-marmitas",
        priceRangeCents: { minCents: 2_990, maxCents: 2_990 },
      },
      {
        id: "m-peixe",
        name: "Peixe assado",
        categoryId: "c-marmitas",
        priceRangeCents: { minCents: 3_190, maxCents: 3_190 },
      },
      {
        id: "m-coca",
        name: "Coca-Cola",
        categoryId: "c-bebidas",
        priceRangeCents: { minCents: 600, maxCents: 900 },
      },
      { id: "m-unpriced", name: "Sem preço", categoryId: "c-bebidas" },
    ],
  },
];

const FIVE_MARMITAS: ComboRequirement[] = [
  { categoryIds: ["c-marmitas"], menuItemIds: [], quantity: 5 },
];

function reward(overrides: Partial<ComboRewardValue>): ComboRewardValue {
  return {
    type: "BUNDLE_PRICE",
    percentOffBp: null,
    amountOffCents: null,
    bundlePriceCents: null,
    ...overrides,
  };
}

function lines(
  slots: ComboRequirement[],
  value: ComboRewardValue,
  layout: ComboPreviewLayout,
) {
  const preview = comboPreviewOf(slots, MARMITAS, value);
  if (preview === null) throw new Error("expected a preview");
  const said = comboPreviewLines(preview, value, layout, copy, formatters);
  return {
    items: plain(said.items),
    pays: plain(said.pays),
    examples: plain(said.examples),
  };
}

describe("the reward is one of three, and the third is a closed price", () => {
  it("F1: Porcentagem, Valor fixo, Preço fechado — in that order", () => {
    expect(COMBO_REWARDS).toEqual([
      "PERCENTAGE",
      "FIXED_AMOUNT",
      "BUNDLE_PRICE",
    ]);
    expect(
      COMBO_REWARDS.map((value) => copy.comboRewards.labels[value]),
    ).toEqual(["Porcentagem", "Valor fixo", "Preço fechado"]);
  });

  it("F2: a combo at a closed price is sent as BUNDLE_PRICE over COMBO", () => {
    expect(
      typeAndScopeFor({
        kind: "COMBO",
        comboReward: "BUNDLE_PRICE",
        scope: "ITEM",
      }),
    ).toEqual({
      type: "BUNDLE_PRICE",
      scope: "COMBO",
    });
  });

  it("F3: a rule saved as BUNDLE_PRICE reads back as a combo with the closed price chosen", () => {
    expect(kindOf({ type: "BUNDLE_PRICE", scope: "COMBO" })).toBe("COMBO");
    expect(comboRewardOf({ type: "BUNDLE_PRICE" })).toBe("BUNDLE_PRICE");
  });
});

describe("what the preview works out — the engine's figures", () => {
  it("F4: Preço fechado R$ 120,00 on 5 marmitas: the buyer pays R$ 120,00 and saves R$ 14,50 … R$ 39,50", () => {
    const preview = comboPreviewOf(
      FIVE_MARMITAS,
      MARMITAS,
      reward({ bundlePriceCents: 12_000 }),
    );
    expect(preview).toMatchObject({
      units: 5,
      cheapest: { groupCents: 13_450, savingCents: 1_450, paysCents: 12_000 },
      dearest: { groupCents: 15_950, savingCents: 3_950, paysCents: 12_000 },
      single: {
        quantity: 5,
        cheapestName: "Frango grelhado",
        dearestName: "Peixe assado",
      },
    });
  });

  it("F5: 10% rounds down as the cart does, and R$ 15,00 off comes off both ends", () => {
    const rate = comboPreviewOf(
      FIVE_MARMITAS,
      MARMITAS,
      reward({ type: "PERCENTAGE", percentOffBp: 1_000 }),
    );
    expect([rate?.cheapest.paysCents, rate?.dearest.paysCents]).toEqual([
      12_105, 14_355,
    ]);
    const amount = comboPreviewOf(
      FIVE_MARMITAS,
      MARMITAS,
      reward({ type: "FIXED_AMOUNT", amountOffCents: 1_500 }),
    );
    expect([amount?.cheapest.paysCents, amount?.dearest.paysCents]).toEqual([
      11_950, 14_450,
    ]);
  });

  it("F6: a group naming the parent category takes the products filed under its subcategory", () => {
    const preview = comboPreviewOf(
      [{ categoryIds: ["c-pratos"], menuItemIds: [], quantity: 5 }],
      MARMITAS,
      reward({ bundlePriceCents: 12_000 }),
    );
    expect(preview?.cheapest.groupCents).toBe(13_450);
  });

  it("F7: a product's variations widen its range — the dearest end takes the dearest variation", () => {
    const preview = comboPreviewOf(
      [{ categoryIds: [], menuItemIds: ["m-coca"], quantity: 5 }],
      MARMITAS,
      reward({ bundlePriceCents: 2_500 }),
    );
    expect([preview?.cheapest.groupCents, preview?.dearest.groupCents]).toEqual(
      [3_000, 4_500],
    );
  });

  it("F8: no preview when there is no group, or a group can take no priced product", () => {
    expect(
      comboPreviewOf([], MARMITAS, reward({ bundlePriceCents: 12_000 })),
    ).toBeNull();
    expect(
      comboPreviewOf(
        [{ categoryIds: [], menuItemIds: ["m-unpriced"], quantity: 1 }],
        MARMITAS,
        reward({}),
      ),
    ).toBeNull();
  });
});

describe("what the preview says, word for word as the prototype draws it", () => {
  it("F9: under the field, Preço fechado: the sum and the saving's range", () => {
    expect(
      lines(FIVE_MARMITAS, reward({ bundlePriceCents: 12_000 }), "inline"),
    ).toEqual({
      items: "5 itens somam de R$ 134,50 a R$ 159,50",
      pays: "Cliente paga R$ 120,00 — economiza de R$ 14,50 a R$ 39,50",
      examples: null,
    });
  });

  it("F10: under the field, Porcentagem and Valor fixo: what is paid, as a range", () => {
    expect(
      lines(
        FIVE_MARMITAS,
        reward({ type: "PERCENTAGE", percentOffBp: 1_000 }),
        "inline",
      ).pays,
    ).toBe("Cliente paga de R$ 121,05 a R$ 143,55 (10% a menos)");
    expect(
      lines(
        FIVE_MARMITAS,
        reward({ type: "FIXED_AMOUNT", amountOffCents: 1_500 }),
        "inline",
      ).pays,
    ).toBe("Cliente paga de R$ 119,50 a R$ 144,50");
  });

  it("F11: in its own column: a short second line and the examples at both ends", () => {
    expect(
      lines(FIVE_MARMITAS, reward({ bundlePriceCents: 12_000 }), "aside"),
    ).toEqual({
      items: "5 itens somam de R$ 134,50 a R$ 159,50",
      pays: "Cliente paga R$ 120,00",
      examples:
        "Exemplos: 5 de Frango grelhado → R$ 120,00 (economiza R$ 14,50) · 5 de Peixe assado → R$ 120,00 (economiza R$ 39,50)",
    });
    expect(
      lines(
        FIVE_MARMITAS,
        reward({ type: "PERCENTAGE", percentOffBp: 1_000 }),
        "aside",
      ),
    ).toEqual({
      items: "5 itens somam de R$ 134,50 a R$ 159,50",
      pays: "Cliente paga 10% a menos",
      examples:
        "Exemplos: 5 de Frango grelhado → R$ 121,05 · 5 de Peixe assado → R$ 143,55",
    });
    expect(
      lines(
        FIVE_MARMITAS,
        reward({ type: "FIXED_AMOUNT", amountOffCents: 1_500 }),
        "aside",
      ).pays,
    ).toBe("Cliente paga R$ 15,00 a menos");
  });

  it("F12: a price between the two sums — the cheapest combo costs its items", () => {
    const value = reward({ bundlePriceCents: 14_000 });
    expect(lines(FIVE_MARMITAS, value, "inline").pays).toBe(
      "Cliente paga de R$ 134,50 a R$ 140,00 — economiza até R$ 19,50",
    );
    expect(lines(FIVE_MARMITAS, value, "aside").pays).toBe(
      "Cliente paga de R$ 134,50 a R$ 140,00",
    );
  });

  it("F13: a price at or above the dearest sum saves nothing, and says so", () => {
    expect(
      lines(FIVE_MARMITAS, reward({ bundlePriceCents: 16_000 }), "inline").pays,
    ).toBe(
      "Cliente paga o preço dos itens: o preço do combo não é menor que eles.",
    );
  });

  it("F14: a price not typed yet: only what the items sum to", () => {
    expect(lines(FIVE_MARMITAS, reward({}), "inline")).toEqual({
      items: "5 itens somam de R$ 134,50 a R$ 159,50",
      pays: null,
      examples: null,
    });
  });

  it("F15: one price for every item collapses the ranges, and drops the examples", () => {
    const one: ComboRequirement[] = [
      { categoryIds: [], menuItemIds: ["m-frango"], quantity: 5 },
    ];
    expect(lines(one, reward({ bundlePriceCents: 12_000 }), "inline")).toEqual({
      items: "5 itens somam R$ 134,50",
      pays: "Cliente paga R$ 120,00 — economiza R$ 14,50",
      examples: null,
    });
    expect(
      lines(one, reward({ bundlePriceCents: 12_000 }), "aside").examples,
    ).toBeNull();
  });

  it("F16: several groups — no examples, since no one product names the combo", () => {
    const two: ComboRequirement[] = [
      ...FIVE_MARMITAS,
      { categoryIds: ["c-bebidas"], menuItemIds: [], quantity: 1 },
    ];
    expect(
      lines(two, reward({ bundlePriceCents: 12_000 }), "aside"),
    ).toMatchObject({
      items: "6 itens somam de R$ 140,50 a R$ 168,50",
      examples: null,
    });
  });

  it("F28: overlapping groups — 2 of any bebida plus 1 Coca — each group takes its own cheapest and dearest", () => {
    const overlapping: ComboRequirement[] = [
      { categoryIds: ["c-bebidas"], menuItemIds: [], quantity: 2 },
      { categoryIds: [], menuItemIds: ["m-coca"], quantity: 1 },
    ];
    const price = comboPreviewOf(
      overlapping,
      MARMITAS,
      reward({ bundlePriceCents: 2_000 }),
    );
    expect(price).toMatchObject({
      units: 3,
      cheapest: { groupCents: 1_800, savingCents: 0, paysCents: 1_800 },
      dearest: { groupCents: 2_700, savingCents: 700, paysCents: 2_000 },
      single: null,
    });
    const rate = comboPreviewOf(
      overlapping,
      MARMITAS,
      reward({ type: "PERCENTAGE", percentOffBp: 1_050 }),
    );
    // 10.5% of R$ 18,00 is R$ 1,89; of R$ 27,00, R$ 2,835 — rounded down, as the cart does.
    expect([rate?.cheapest.paysCents, rate?.dearest.paysCents]).toEqual([
      1_611, 2_417,
    ]);
  });

  it("F29: one product named in two groups is priced in each of them", () => {
    const twice: ComboRequirement[] = [
      { categoryIds: [], menuItemIds: ["m-coca"], quantity: 1 },
      { categoryIds: [], menuItemIds: ["m-coca", "m-frango"], quantity: 1 },
    ];
    const preview = comboPreviewOf(
      twice,
      MARMITAS,
      reward({ type: "FIXED_AMOUNT", amountOffCents: 2_000 }),
    );
    expect(preview).toMatchObject({
      cheapest: { groupCents: 1_200, savingCents: 1_200, paysCents: 0 },
      dearest: { groupCents: 3_590, savingCents: 2_000, paysCents: 1_590 },
    });
  });

  it("F30: a price equal to the cheapest sum saves 'up to', never 'from R$ 0,00'", () => {
    expect(
      lines(FIVE_MARMITAS, reward({ bundlePriceCents: 13_450 }), "inline").pays,
    ).toBe("Cliente paga R$ 134,50 — economiza até R$ 25,00");
  });
});

/* ---------------------------------------------------------------- the form */

/** A currency field BOUND to the form, as the host's is — typing reaches the preview and the submit. */
function BoundCurrency({ name, label }: { name: string; label: string }) {
  const { values, errors, setFieldValue } = useFormContext();
  return (
    <label>
      <input
        name={name}
        aria-label={label}
        data-testid={`currency-${name}`}
        value={values[name] ?? ""}
        onChange={(event) => setFieldValue(name, event.target.value)}
      />
      {errors[name] && <span>{errors[name]}</span>}
    </label>
  );
}

function recordingTransport(): {
  transport: DiscountsTransport;
  sent: unknown[];
} {
  const sent: unknown[] = [];
  return {
    sent,
    transport: {
      get: <T,>(): Promise<T> => Promise.resolve({ data: MARMITAS } as T),
      send: <T,>(
        _url: string,
        _method: string,
        body?: unknown,
      ): Promise<DiscountsResult<T>> => {
        sent.push(body);
        return Promise.resolve({ ok: true, data: null as T });
      },
    },
  };
}

function record(
  overrides: Partial<DiscountWireRecord> = {},
): DiscountWireRecord {
  return {
    id: "d-marmitas",
    name: "5 marmitas por R$ 120",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
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
    comboRequirements: FIVE_MARMITAS,
    createdAt: "2026-11-05T00:00:00.000Z",
    ...overrides,
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
      currencyField={BoundCurrency}
      groups={MARMITAS}
      editing={editing}
      onSaved={onSaved}
      onError={() => {}}
    />,
  );
  return { sent, onSaved };
}

/** Every element observed reports `width` px — the form's own width, not the window's. */
function containerWidth(width: number): void {
  class FixedWidthObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: { width },
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", FixedWidthObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function pickPrice(): void {
  fireEvent.click(
    screen.getByTestId("total-form-field-comboReward-item-BUNDLE_PRICE"),
  );
}

describe("the form", () => {
  it("F17: choosing Preço fechado mounts the price field and its hint, and nothing of the other two", async () => {
    renderForm(record());
    pickPrice();
    await waitFor(() =>
      expect(screen.getByTestId("currency-bundlePrice")).toBeTruthy(),
    );
    expect(screen.queryByTestId("currency-amountOff")).toBeNull();
    expect(screen.getByTestId("combo-reward-hint").textContent).toBe(
      "O combo sai por este preço, qualquer que seja o preço dos itens.",
    );
  });

  it("F18: typing the price shows what the buyer pays in the cart", async () => {
    renderForm(record());
    pickPrice();
    fireEvent.change(await screen.findByTestId("currency-bundlePrice"), {
      target: { value: "120,00" },
    });
    const preview = await screen.findByTestId("combo-cart-preview");
    expect(
      within(preview).getByText(copy.comboRewards.preview.title),
    ).toBeTruthy();
    // A small label over the figures (the prototype's heading), not the Alert's larger title.
    const heading = within(preview).getByTestId("combo-cart-preview-heading");
    expect(heading.textContent).toBe("Como fica no carrinho");
    const [headingPx, itemsPx] = [
      heading,
      screen.getByTestId("combo-cart-preview-items"),
    ].map((node) => parseFloat(getComputedStyle(node).fontSize));
    // Both are rem off the same root: the heading is the smaller, and semibold.
    expect(headingPx).toBeLessThan(itemsPx);
    expect(getComputedStyle(heading).fontWeight).toBe("600");
    expect(
      plain(screen.getByTestId("combo-cart-preview-pays").textContent),
    ).toBe("Cliente paga R$ 120,00 — economiza de R$ 14,50 a R$ 39,50");
  });

  it("F19: Criar desconto sends the closed price over COMBO", async () => {
    const { sent, onSaved } = renderForm(record());
    pickPrice();
    fireEvent.change(await screen.findByTestId("currency-bundlePrice"), {
      target: { value: "120,00" },
    });
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent[0]).toMatchObject({
      type: "BUNDLE_PRICE",
      scope: "COMBO",
      bundlePriceCents: 12_000,
      percentOffBp: null,
      amountOffCents: null,
      comboRequirements: FIVE_MARMITAS,
    });
  });

  it("F20: a closed price left blank is refused on its field", async () => {
    const { onSaved } = renderForm(record());
    pickPrice();
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    expect(await screen.findByText(copy.form.invalidBundlePrice)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("F21: a saved BUNDLE_PRICE rule opens as Combo + Preço fechado, with four kinds and its price", async () => {
    renderForm(
      record({
        type: "BUNDLE_PRICE",
        percentOffBp: null,
        bundlePriceCents: 12_000,
      }),
    );
    const kinds = within(
      screen.getByTestId("total-form-field-kind"),
    ).getAllByRole("button");
    expect(kinds.map((button) => button.textContent)).toEqual([
      "Porcentagem",
      "Valor fixo",
      "Combo",
      "Itens grátis",
    ]);
    expect(
      screen
        .getByTestId("total-form-field-comboReward-item-BUNDLE_PRICE")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByTestId("currency-bundlePrice") as HTMLInputElement).value,
    ).toBe("120");
  });

  it("F22: the preview follows the reward — Porcentagem shows its own range", async () => {
    renderForm(record());
    expect(
      plain((await screen.findByTestId("combo-cart-preview-pays")).textContent),
    ).toBe("Cliente paga de R$ 121,05 a R$ 143,55 (10% a menos)");
  });
});

describe("where it sits (ADR 0190 in the host; prototype option A)", () => {
  function rewardControl(): "select" | "toggle" {
    const field = screen.getByTestId("total-form-field-comboReward");
    return within(field).queryAllByRole("combobox").length > 0
      ? "select"
      : "toggle";
  }

  it("F23: at 288 px (a 320 phone) the three choices are a select, never a wrapped toggle", async () => {
    containerWidth(288);
    renderForm(record());
    await waitFor(() => expect(rewardControl()).toBe("select"));
    expect(
      screen.getByTestId("combo-preview-layout").getAttribute("data-layout"),
    ).toBe("inline");
  });

  it("F24: at 430 px the three fit as a toggle, with the value's field under them", async () => {
    containerWidth(430);
    renderForm(record());
    await waitFor(() => expect(rewardControl()).toBe("toggle"));
    expect(
      screen.getByTestId("combo-reward-row").getAttribute("style") ?? "",
    ).not.toContain("1fr 1fr");
  });

  it("F25: a wide form puts the preview in its own column, with the examples line", async () => {
    containerWidth(960);
    renderForm(record());
    await waitFor(() =>
      expect(
        screen.getByTestId("combo-preview-layout").getAttribute("data-layout"),
      ).toBe("aside"),
    );
    expect(
      plain(screen.getByTestId("combo-cart-preview-pays").textContent),
    ).toBe("Cliente paga 10% a menos");
    expect(screen.getByTestId("combo-cart-preview-examples")).toBeTruthy();
  });

  it("F27: a form too narrow to keep the kind toggle beside a column keeps the preview inline", async () => {
    containerWidth(760);
    renderForm(record());
    await waitFor(() =>
      expect(screen.getByTestId("combo-cart-preview")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("combo-preview-layout").getAttribute("data-layout"),
    ).toBe("inline");
    expect(screen.queryByTestId("combo-cart-preview-examples")).toBeNull();
  });

  it("F26: no column for a kind that is not a combo", async () => {
    containerWidth(960);
    renderForm(record({ scope: "ORDER", comboRequirements: [] }));
    await waitFor(() =>
      expect(
        screen.getByTestId("combo-preview-layout").getAttribute("data-layout"),
      ).toBe("inline"),
    );
    expect(screen.queryByTestId("combo-cart-preview")).toBeNull();
  });
});
