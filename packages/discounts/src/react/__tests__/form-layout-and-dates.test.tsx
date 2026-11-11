// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters, formatWindow } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { peek, reach, settle, submitForm } from "./step-form-shim";

/**
 * The discount form at phone width and in an English browser (FUT-4155,
 * FUT-4156, FUT-4157): the kind question on one line, the schedule's refusal
 * on the schedule, and day-first dates whatever the browser's language.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

function renderForm(editing: DiscountWireRecord | null = null, wholeDays = false): { sent: unknown[] } {
  const sent: unknown[] = [];
  const transport: DiscountsTransport = {
    get: <T,>(url: string): Promise<T> =>
      url.includes("/discounts/targets")
        ? Promise.resolve({ data: STORY_GROUPS } as T)
        : Promise.resolve({ data: [], pagination: {} } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.push(body);
      return Promise.resolve({ ok: true, data: null as T });
    },
  };
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={editing}
      onSaved={vi.fn()}
      onError={() => {}}
      timezoneLabel="Horário de Brasília"
      wholeDays={wholeDays}
    />,
  );
  return { sent };
}

function record(overrides: Partial<DiscountWireRecord> = {}): DiscountWireRecord {
  return {
    id: "d-1",
    name: "Semana do cliente",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
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
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(testId: string): HTMLInputElement {
  return reach(testId) as HTMLInputElement;
}

function type(testId: string, value: string): void {
  fireEvent.change(input(testId), { target: { value } });
}

function submit(): void {
  submitForm();
}

function fillValid(): void {
  type("total-form-field-name", "Happy hour");
  type("total-form-field-percentOff", "10");
}

function fieldMessage(name: string): string | null {
  return screen.queryByTestId(`total-form-field-${name}-message`)?.textContent ?? null;
}

/** Every element observed reports `width` px — the form's own width, not the window's. */
function containerWidth(width: number): void {
  class FixedWidthObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
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

/** How the Tipo cards are laid out: one row of four, or one column (FUT-4477). */
function tipoLayout(): string | null {
  return reach("discount-kind-cards").getAttribute("data-layout");
}

// FUT-4157's toggle-or-select is replaced by the Tipo cards (FUT-4475, "Tipo"):
// still one question on one line or a list, by the FORM's width (ADR 0190).
describe("FUT-4477: Tipo is four cards, one row or one column", () => {
  it("Q1: a form too narrow for a row of four stacks them in ONE column, never two by two", async () => {
    containerWidth(288);
    renderForm();
    await waitFor(() => expect(tipoLayout()).toBe("column"));
    // The library's radiogroup (FUT-4477, UI review B6) inside the measured box.
    const group = within(reach("discount-kind-cards")).getByRole("radiogroup", { name: copy.form.kind });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
  });

  it("Q2: picking Combo there switches the form exactly as before", async () => {
    containerWidth(288);
    renderForm();
    fireEvent.click(reach("discount-kind-COMBO"));
    expect(reach("discount-kind-COMBO").getAttribute("aria-checked")).toBe("true");
    expect(reach("combo-slots")).toBeTruthy();
    expect(screen.queryAllByTestId("total-form-field-scope")).toHaveLength(0);
  });

  it("Q3: a wide form keeps the four on one row", async () => {
    containerWidth(900);
    renderForm();
    await waitFor(() => expect(tipoLayout()).toBe("row"));
  });

  it("Q4: the arrows move the choice, as a radio group's do", async () => {
    renderForm();
    const percentage = reach("discount-kind-PERCENTAGE");
    await waitFor(() => expect(percentage.getAttribute("tabindex")).toBe("0"));
    fireEvent.keyDown(percentage, { key: "ArrowRight" });
    await waitFor(() => expect(peek("discount-kind-FIXED_AMOUNT").getAttribute("aria-checked")).toBe("true"));
    fireEvent.keyDown(peek("discount-kind-FIXED_AMOUNT"), { key: "End" });
    await waitFor(() => expect(peek("discount-kind-FREE_UNITS").getAttribute("aria-checked")).toBe("true"));
  });

  it("Q5: a combo's refusal is said at the foot of step 2", async () => {
    containerWidth(288);
    renderForm(record({ scope: "COMBO", comboRequirements: [] }));
    submit();
    await waitFor(() => expect(peek("discount-step-targets-message").textContent).toBe(copy.form.comboSlotsRequired));
  });
});

describe("FUT-4155: the schedule's refusal is said on the schedule", () => {
  function scheduleMessage(): string | null {
    return screen.queryByTestId("schedule-builder-message")?.textContent ?? null;
  }

  it("S1: no day chosen", async () => {
    const { sent } = renderForm();
    fillValid();
    fireEvent.click(reach("repetition-specific"));
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.daysRequired));
    expect(sent).toHaveLength(0);
  });

  it("S2: a window that starts when it ends", async () => {
    renderForm();
    fillValid();
    fireEvent.click(reach("repetition-specific"));
    fireEvent.click(reach(`schedule-preset-${copy.schedule.presetEveryDay}`));
    type("schedule-to-0", "1600");
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.timesRequired));
  });

  it("S3: the refusal clears once the schedule is edited, like a field's", async () => {
    renderForm();
    fillValid();
    fireEvent.click(reach("repetition-specific"));
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.daysRequired));
    fireEvent.click(reach(`schedule-preset-${copy.schedule.presetWeekdays}`));
    await waitFor(() => expect(screen.queryAllByTestId("schedule-builder-message")).toHaveLength(0));
  });

  it("S4: a combo with no groups is refused on the kind, which paints it", async () => {
    renderForm(record({ scope: "COMBO", comboRequirements: [] }));
    submit();
    // The kind's message is said at the foot of step 2 now, the step the
    // refusal opens (FUT-4477): the Tipo cards carry no field message.
    await waitFor(() => expect(peek("discount-step-targets-message").textContent).toBe(copy.form.comboSlotsRequired));
  });

  it("S5: leve 3 pague 2 with no product is refused on the kind in its own words", async () => {
    renderForm(
      record({ type: "FREE_UNITS", scope: "COMBO", percentOffBp: null, freeUnits: 1, comboRequirements: [] }),
    );
    submit();
    // Under the products picker, once (FUT-4477): the same sentence is not said again from `kind`.
    await waitFor(() => expect(peek("free-units-message").textContent).toBe(copy.form.freeUnitsTargetRequired));
    expect(screen.getAllByText(copy.form.freeUnitsTargetRequired)).toHaveLength(1);
  });
});

describe("FUT-4156: Início and Término are DD/MM/AAAA on every browser", () => {
  it("D1: masked text with a numeric keypad, never type=date", () => {
    renderForm();
    for (const name of ["startsAt", "endsAt"]) {
      const dateBox = input(`total-form-field-${name}`);
      expect(dateBox.getAttribute("type")).toBe("text");
      expect(dateBox.getAttribute("inputmode")).toBe("numeric");
      expect(dateBox.getAttribute("placeholder")).toBe(copy.form.datePlaceholder);
    }
  });

  it("D2: eight digits read day-first and reach the wire as the same ISO day", async () => {
    const { sent } = renderForm();
    fillValid();
    type("total-form-field-startsAt", "15102026");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("15/10/2026"));
    type("total-form-field-endsAt", "3112");
    await waitFor(() => expect(input("total-form-field-endsAt").value).toBe("31/12"));
    type("total-form-field-endsAt", "31122026");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-10-15", endsAt: "2026-12-31" });
  });

  it("D3: 31/02/2026 is marked as it is typed and refused at Criar", async () => {
    const { sent } = renderForm();
    fillValid();
    type("total-form-field-startsAt", "31022026");
    await waitFor(() => expect(fieldMessage("startsAt")).toBe(copy.form.invalidDate));
    expect(input("total-form-field-startsAt").getAttribute("aria-invalid")).toBe("true");
    submit();
    // A client refusal is said on its step, not by the toast (FUT-4477).
    await settle();
    expect(fieldMessage("startsAt")).toBe(copy.form.invalidDate);
    expect(sent).toHaveLength(0);
  });

  it("D4: a half-typed date is quiet while typed, and refused at Criar as unfinished", async () => {
    const { sent } = renderForm();
    fillValid();
    type("total-form-field-endsAt", "120");
    await waitFor(() => expect(input("total-form-field-endsAt").value).toBe("12/0"));
    expect(input("total-form-field-endsAt").getAttribute("aria-invalid")).toBe("false");
    submit();
    await waitFor(() => expect(fieldMessage("endsAt")).toBe(copy.form.dateIncomplete));
    expect(sent).toHaveLength(0);
  });

  it("D5: a saved rule's dates round-trip unchanged", async () => {
    const { sent } = renderForm(
      record({ startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-11-30T00:00:00.000Z" }),
    );
    expect(input("total-form-field-startsAt").value).toBe("01/09/2026");
    expect(input("total-form-field-endsAt").value).toBe("30/11/2026");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-09-01", endsAt: "2026-11-30" });
  });

  it("D6: editing the day in place keeps the slashes", async () => {
    renderForm(record({ startsAt: "2026-10-25T00:00:00.000Z" }));
    expect(input("total-form-field-startsAt").value).toBe("25/10/2026");
    type("total-form-field-startsAt", "0/10/2026");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("0/10/2026"));
    type("total-form-field-startsAt", "05/10/2026");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("05/10/2026"));
  });

  it("D7: typing past a full part still moves on to the next one", async () => {
    renderForm();
    type("total-form-field-startsAt", "12/03");
    type("total-form-field-startsAt", "12/032");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("12/03/2"));
  });

  it("D8: a pasted ISO date is read as that date", async () => {
    renderForm();
    type("total-form-field-startsAt", "2026-10-01");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("01/10/2026"));
  });

  it("D9: Término before Início is still refused, and a cleared date is sent as none", async () => {
    const { sent } = renderForm(record({ startsAt: "2026-10-10T00:00:00.000Z" }));
    type("total-form-field-endsAt", "01102026");
    submit();
    await waitFor(() => expect(fieldMessage("endsAt")).toBe(copy.form.endsBeforeStarts));
    type("total-form-field-endsAt", "");
    type("total-form-field-startsAt", "");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: null, endsAt: null });
  });
});

describe("FUT-4482: the chosen days read back whole, in the store's zone", () => {
  // Início 10/11 and Término 20/11 in São Paulo, as a zone-aware server stores
  // them and answers them: 00:00 of the 10th and of the 21st there, plus the days.
  const zoned = { startsAt: "2026-11-10T03:00:00.000Z", endsAt: "2026-11-21T03:00:00.000Z", startsOn: "2026-11-10", endsOn: "2026-11-20" };

  it("W1: the edit form shows the days the server says, not the instants' UTC days", () => {
    renderForm(record(zoned));
    expect(input("total-form-field-startsAt").value).toBe("10/11/2026");
    expect(input("total-form-field-endsAt").value).toBe("20/11/2026");
  });

  it("W2: the list says the same two days", () => {
    expect(formatWindow({ ...zoned, schedule: null }, formatters, copy)).toBe("10/11/2026 a 20/11/2026");
  });

  // W3/W4 are a server that counts whole days (`wholeDays`); without it equal
  // days are refused, as that server refuses them (period-calendar-round-two).
  it("W3: Início = Término is a one-day promotion, sent as that day twice", async () => {
    const { sent } = renderForm(null, true);
    fillValid();
    type("total-form-field-startsAt", "20112026");
    type("total-form-field-endsAt", "20112026");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-11-20", endsAt: "2026-11-20" });
  });

  it("W4: Término before Início is refused in words that allow the same day", async () => {
    renderForm(null, true);
    type("total-form-field-startsAt", "20112026");
    type("total-form-field-endsAt", "19112026");
    submit();
    await waitFor(() =>
      expect(fieldMessage("endsAt")).toBe("A data de término não pode ser anterior à data de início."),
    );
  });
});

describe("an unfinished value is told to finish, not that it is wrong", () => {
  it("I1: '25/10/202' is quiet while typed and says 'Termine a data' once left", async () => {
    renderForm();
    type("total-form-field-startsAt", "2510202");
    await waitFor(() => expect(input("total-form-field-startsAt").value).toBe("25/10/202"));
    expect(fieldMessage("startsAt")).toBeNull();
    fireEvent.blur(input("total-form-field-startsAt"));
    await waitFor(() => expect(fieldMessage("startsAt")).toBe("Termine a data: DD/MM/AAAA."));
    type("total-form-field-startsAt", "25102026");
    await waitFor(() => expect(screen.queryAllByTestId("total-form-field-startsAt-message")).toHaveLength(0));
  });

  it("I2: at Criar an unfinished date is unfinished and an impossible one does not exist", async () => {
    const { sent } = renderForm();
    fillValid();
    type("total-form-field-startsAt", "2510202");
    type("total-form-field-endsAt", "31022027");
    submit();
    await waitFor(() => expect(fieldMessage("startsAt")).toBe(copy.form.dateIncomplete));
    expect(fieldMessage("endsAt")).toBe(copy.form.invalidDate);
    expect(sent).toHaveLength(0);
  });

  it("I3: a clock left at '1:00' says 'Termine o horário' on blur, never while typed", async () => {
    renderForm();
    fireEvent.click(reach("repetition-specific"));
    type("schedule-from-0", "0900");
    type("schedule-from-0", "1:00");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("1:00"));
    expect(screen.queryAllByTestId("schedule-from-0-message")).toHaveLength(0);
    fireEvent.blur(input("schedule-from-0"));
    await waitFor(() =>
      expect(peek("schedule-from-0-message").textContent).toBe(
        "Termine o horário: HH:MM.",
      ),
    );
    type("schedule-from-0", "15:00");
    await waitFor(() => expect(screen.queryAllByTestId("schedule-from-0-message")).toHaveLength(0));
  });

  it("I4: at Criar the schedule says the time is unfinished, not that the ends must differ", async () => {
    const { sent } = renderForm();
    fillValid();
    fireEvent.click(reach("repetition-specific"));
    fireEvent.click(reach(`schedule-preset-${copy.schedule.presetEveryDay}`));
    type("schedule-from-0", "1:00");
    submit();
    // Said once, by the clock it is about (FUT-4143 code review round 3).
    await waitFor(() =>
      expect(peek("schedule-from-0-message").textContent).toBe(
        copy.schedule.timeIncomplete,
      ),
    );
    expect(screen.queryAllByText(copy.schedule.timesRequired)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("I5: the en-US pack says both in English", () => {
    expect(EN_US_DISCOUNTS_WEB_COPY.form.dateIncomplete).toBe("Finish the date: DD/MM/YYYY.");
    expect(EN_US_DISCOUNTS_WEB_COPY.schedule.timeIncomplete).toBe("Finish the time: HH:MM.");
  });
});
