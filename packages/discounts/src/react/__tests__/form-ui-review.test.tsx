// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { ComboSlotBuilder } from "../combo-slot-builder";
import type { DiscountsWebCopy } from "../copy";
import { DiscountForm } from "../discount-form";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import type { ComboRequirement } from "../../engine/types";

/**
 * The discount form's UI review, round 1 (FUT-4143): the combo read-back in
 * the right number, and the schedule's refusal under the control it is about.
 * The one-line layouts (day chips, presets, "Adicionar grupo") are measured in
 * a browser, where widths exist; jsdom has none.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

function renderForm(): void {
  const transport: DiscountsTransport = {
    get: <T,>(url: string): Promise<T> =>
      url.includes("/discounts/targets")
        ? Promise.resolve({ data: STORY_GROUPS } as T)
        : Promise.resolve({ data: [], pagination: {} } as T),
    send: <T,>(): Promise<DiscountsResult<T>> => Promise.resolve({ ok: true, data: null as T }),
  };
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={null as DiscountWireRecord | null}
      onSaved={vi.fn()}
      onError={() => {}}
      timezoneLabel="Horário de Brasília"
    />,
  );
}

function slot(quantity: number): ComboRequirement {
  return { quantity, categoryIds: ["c-sodas"], menuItemIds: [] };
}

function summaryOf(slots: ComboRequirement[], pack: DiscountsWebCopy = copy): string | null {
  const view = render(
    <ComboSlotBuilder slots={slots} groups={STORY_GROUPS} copy={pack} onChange={vi.fn()} />,
  );
  const text = view.getByTestId("combo-summary").textContent;
  view.unmount();
  return text;
}

describe("the combo read-back counts in the right number", () => {
  it.each([
    [[slot(1)], "O combo leva 1 item em 1 grupo."],
    [[slot(4)], "O combo leva 4 itens em 1 grupo."],
    [[slot(2), slot(3)], "O combo leva 5 itens em 2 grupos."],
    [[slot(Number.NaN)], "O combo leva 0 itens em 1 grupo."],
  ])("pt-BR: %j reads %s", (slots, expected) => {
    expect(summaryOf(slots)).toBe(expected);
  });

  it.each([
    [[slot(1)], "The bundle takes 1 item across 1 group."],
    [[slot(2), slot(3)], "The bundle takes 5 items across 2 groups."],
  ])("en-US: %j reads %s", (slots, expected) => {
    expect(summaryOf(slots, EN_US_DISCOUNTS_WEB_COPY)).toBe(expected);
  });
});

/** True when `first` comes before `second` in the document. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("the schedule's refusal sits under what it is about", () => {
  function openWithValidName(): void {
    renderForm();
    fireEvent.change(screen.getByTestId("total-form-field-name"), { target: { value: "Happy hour" } });
    fireEvent.change(screen.getByTestId("total-form-field-percentOff"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("repetition-specific"));
  }

  it("U1: 'Escolha ao menos um dia' is right under that row's day chips", async () => {
    openWithValidName();
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    const message = await screen.findByTestId("schedule-builder-message");
    expect(message.textContent).toBe(copy.schedule.daysRequired);
    const row = screen.getByTestId("schedule-window-0");
    expect(within(row).getByTestId("schedule-builder-message")).toBe(message);
    expect(precedes(within(row).getByTestId("schedule-days-0"), message)).toBe(true);
    expect(precedes(message, screen.getByTestId("schedule-from-0"))).toBe(true);
  });

  it("U2: a time refusal is under the time row of the window it is about", async () => {
    openWithValidName();
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetEveryDay}`));
    fireEvent.click(screen.getByTestId("schedule-add-window"));
    fireEvent.click(screen.getByTestId(`schedule-day-1-${copy.schedule.dayShort[0] ?? ""}`));
    fireEvent.change(screen.getByTestId("schedule-to-1"), { target: { value: "1600" } });
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    const message = await screen.findByTestId("schedule-builder-message");
    expect(message.textContent).toBe(copy.schedule.timesRequired);
    expect(within(screen.getByTestId("schedule-window-1")).getByTestId("schedule-builder-message")).toBe(
      message,
    );
    expect(precedes(screen.getByTestId("schedule-to-1"), message)).toBe(true);
    await waitFor(() =>
      expect(within(screen.getByTestId("schedule-window-0")).queryAllByTestId("schedule-builder-message")).toHaveLength(0),
    );
  });
});
