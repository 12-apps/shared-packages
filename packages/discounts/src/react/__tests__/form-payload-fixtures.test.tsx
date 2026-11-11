// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import { createDiscountsApiClient, type WireTargetGroup } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";

import PAYLOADS from "./fixtures/form-payloads.json";
import HARNESS_TARGETS from "./fixtures/harness-targets.json";
import { reach, showEveryStep } from "./step-form-shim";

/**
 * The wire body is the form's contract, and a redesign of the form must not
 * move it (FUT-4477, "Prove the payload unchanged").
 *
 * `fixtures/form-payloads.json` holds what the form POSTed on main for four
 * inputs, one per kind, captured in Chromium on the harness seed
 * (`fixtures/harness-targets.json`: Bebidas / Lanches, Café / Suco /
 * X-Salada). Each case here types the same input into the form and compares
 * the body it sends with the captured one, whole. The pickers are replaced by
 * a button that picks the named targets — their MUI lists are the harness
 * journey's to drive, and this file is about what leaves the form.
 */
vi.mock("../target-picker-field", () => ({
  TargetPickerField: ({
    onChange,
    dataTestId,
  }: {
    onChange: (next: string[]) => void;
    dataTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={`${dataTestId ?? "picker"}-pick`}
      onClick={() => onChange(pickedFor(dataTestId ?? ""))}
    >
      pick
    </button>
  ),
}));

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const GROUPS = HARNESS_TARGETS as WireTargetGroup[];

/** What each picker picks in the case being run, by its test id. */
const picks = new Map<string, string[]>();
function pickedFor(testId: string): string[] {
  return picks.get(testId) ?? [];
}

/** The pick a case makes, set before it types. */
function willPick(testId: string, names: string[]): void {
  picks.clear();
  picks.set(testId, names.map(idOf));
}

/** A target's id on the harness seed, by its name. */
function idOf(name: string): string {
  const target = GROUPS.flatMap((group) => group.targets).find((entry) => entry.name === name);
  if (!target) throw new Error(`no harness target named ${name}`);
  return target.id;
}

/** The harness's money input: a plain `Fields.TextField`, as `harness/frontend` passes. */
function CurrencyField({ name, label }: { name: string; label: string }) {
  return <Fields.TextField name={name} label={label} />;
}

function renderForm(sent: unknown[]): void {
  const transport: DiscountsTransport = {
    get: <T,>(): Promise<T> => Promise.resolve({ data: GROUPS } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.push(JSON.parse(JSON.stringify(body)));
      return Promise.resolve({ ok: true, data: null as T });
    },
  };
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/harness", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={CurrencyField}
      groups={GROUPS}
      editing={null}
      onSaved={() => {}}
      onError={() => {}}
    />,
  );
}

/** Type into a field by test id, whether the id sits on the input or around it. */
function type(testId: string, value: string): void {
  const node = reach(testId);
  fireEvent.change(node.querySelector("input") ?? node, { target: { value } });
}

function click(testId: string): void {
  fireEvent.click(reach(testId));
}

/** A `Switch` by its test id: its checkbox. */
function toggle(testId: string): void {
  const root = reach(testId);
  fireEvent.click(root.querySelector('input[type="checkbox"]') ?? root);
}

type Fixture = { inputs: Record<string, unknown>; body: Record<string, unknown> };
const FIXTURES = (PAYLOADS as { fixtures: Record<string, Fixture> }).fixtures;

/** Today's form, field by field, for each captured input. */
const FILL: Record<string, () => void> = {
  "percentage-category-schedule": () => {
    willPick("discount-categories-targets", ["Bebidas"]);
    type("total-form-field-name", "10% em Bebidas no almoço");
    click("discount-kind-PERCENTAGE");
    type("total-form-field-percentOff", "10");
    click("total-form-field-scope-item-CATEGORY");
    click("discount-categories-targets-pick");
    click("repetition-specific");
    click(`schedule-preset-${copy.schedule.presetWeekdays}`);
    type("schedule-from-0", "11:00");
    type("schedule-to-0", "14:00");
  },
  "fixed-item-coupon-rules": () => {
    willPick("discount-items-targets", ["X-Salada"]);
    type("total-form-field-name", "R$ 5 no X-Salada");
    click("discount-kind-FIXED_AMOUNT");
    type("total-form-field-amountOff", "5,00");
    click("total-form-field-scope-item-ITEM");
    click("discount-items-targets-pick");
    click("total-form-field-trigger-item-CODE");
    type("total-form-field-code", "XSALADA5");
    type("total-form-field-startsAt", "01/12/2026");
    type("total-form-field-endsAt", "31/12/2026");
    type("total-form-field-minSubtotal", "20,00");
    type("total-form-field-usageLimit", "100");
    type("total-form-field-perBuyerLimit", "1");
    toggle("discount-first-order-only");
    toggle("discount-stackable");
  },
  "combo-bundle-price": () => {
    willPick("combo-slot-0-categories", ["Lanches"]);
    type("total-form-field-name", "2 Lanches por R$ 30");
    click("discount-kind-COMBO");
    click("combo-add-slot");
    type("combo-slot-0-quantity", "2");
    click("combo-slot-0-categories-pick");
    click("total-form-field-comboReward-item-BUNDLE_PRICE");
    type("total-form-field-bundlePrice", "30,00");
  },
  "free-units-cafe-suco": () => {
    willPick("free-units-items", ["Café", "Suco"]);
    type("total-form-field-name", "Leve 3, pague 2 em Café e Suco");
    click("discount-kind-FREE_UNITS");
    type("free-units-quantity", "3");
    type("free-units-free", "1");
    click("free-units-items-pick");
    type("total-form-field-maxComboApplications", "2");
  },
};

afterEach(() => {
  cleanup();
  picks.clear();
});

describe("FUT-4477: the form sends the body main sent, for every kind", () => {
  it("covers one captured input per kind, and nothing else", () => {
    expect(Object.keys(FILL).sort()).toEqual(Object.keys(FIXTURES).sort());
    expect(Object.values(FIXTURES).map((fixture) => fixture.inputs.kind).sort()).toEqual(
      ["COMBO", "FIXED_AMOUNT", "FREE_UNITS", "PERCENTAGE"],
    );
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: the POST body equals the captured one`, async () => {
      const sent: unknown[] = [];
      renderForm(sent);
      // "Ver tudo numa página": the same fields as the single page, every step open.
      showEveryStep();
      FILL[name]!();
      // Every step answered: nothing is pending, so Criar is not held.
      expect(screen.getByTestId("discount-form-submit").hasAttribute("disabled")).toBe(false);
      fireEvent.click(screen.getByTestId("discount-form-submit"));
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual(fixture.body);
    });
  }
});
