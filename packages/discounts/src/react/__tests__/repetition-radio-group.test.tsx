// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { reach } from "./step-form-shim";

/**
 * The Repetição question is the library's `RadioGroup` (FUT-4724).
 *
 * It was two bare `<input type="radio">` in a flex `<label>`: a 24px row with a
 * 13px mark, 28px apart. The group below is what gives each option a full-height
 * tap target, and these pin its structure: one named radiogroup, two radios in the
 * same order, the same ids and values, the same change behaviour. The 40px itself
 * is measured in a browser, which jsdom cannot do.
 */
const copy = PT_BR_DISCOUNTS_WEB_COPY;

const formatters = createFormatters("pt-BR", "BRL");

function renderForm(): void {
  render(
    <DiscountForm
      api={createDiscountsApiClient(
        "/api/admin/loja",
        {
          get: <T,>(): Promise<T> => Promise.resolve({ data: [], pagination: {} } as T),
          send: <T,>() => Promise.resolve({ ok: true as const, data: null as T }),
        },
        formatters,
      )}
      copy={copy}
      formatters={formatters}
      currencyField={({ name, label }) => <input name={name} aria-label={label} readOnly />}
      groups={STORY_GROUPS}
      editing={null}
      onSaved={vi.fn()}
      onError={() => {}}
      timezoneLabel="Horário Padrão de Brasília"
    />,
  );
}

afterEach(cleanup);

describe("the Repetição options", () => {
  it("are one radiogroup of two radios, in order, named as before", () => {
    renderForm();
    const group = reach("repetition-always").closest("[role=radiogroup]") as HTMLElement;
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];

    expect(radios.map((radio) => radio.dataset.testid)).toEqual(["repetition-always", "repetition-specific"]);
    expect(radios.every((radio) => radio.name === "discount-repetition")).toBe(true);
    expect(screen.getByText(copy.schedule.repetitionTitle)).toBeTruthy();
    expect(screen.getByText(copy.schedule.always)).toBeTruthy();
    expect(screen.getByText(copy.schedule.specific)).toBeTruthy();
  });

  it("checks the always option first, and the specific one once chosen, showing the builder", () => {
    renderForm();
    expect((reach("repetition-always") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("schedule-add-window")).toBeNull();

    fireEvent.click(reach("repetition-specific"));
    expect((reach("repetition-specific") as HTMLInputElement).checked).toBe(true);
    expect((reach("repetition-always") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("schedule-add-window")).toBeTruthy();

    fireEvent.click(reach("repetition-always"));
    expect(screen.queryByTestId("schedule-add-window")).toBeNull();
  });

  it("is a tap target taller than the bare 13px radio: the label wraps a full-size Radio", () => {
    renderForm();
    const radio = reach("repetition-always").closest(".MuiRadio-root");
    expect(radio).not.toBeNull();
    expect((radio as HTMLElement).classList.contains("MuiRadio-sizeSmall")).toBe(false);
  });
});
