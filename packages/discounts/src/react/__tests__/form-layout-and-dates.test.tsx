// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

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

function renderForm(editing: DiscountWireRecord | null = null): { sent: unknown[] } {
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
  return screen.getByTestId(testId) as HTMLInputElement;
}

function type(testId: string, value: string): void {
  fireEvent.change(input(testId), { target: { value } });
}

function submit(): void {
  fireEvent.click(screen.getByTestId("discount-form-submit"));
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

/** The kind control: a select (combobox) or the toggle's buttons. */
function kindControl(): "select" | "toggle" {
  const field = screen.getByTestId("total-form-field-kind");
  return within(field).queryAllByRole("combobox").length > 0 ? "select" : "toggle";
}

async function chooseKindFromSelect(kind: string): Promise<void> {
  fireEvent.mouseDown(within(screen.getByTestId("total-form-field-kind")).getByRole("combobox"));
  fireEvent.click(await screen.findByTestId(`total-form-field-kind-option-${kind}`));
}

describe("FUT-4157: the kind question sits on one line", () => {
  it("Q1: a form too narrow for four equal parts asks it with a select", async () => {
    containerWidth(288);
    renderForm();
    await waitFor(() => expect(kindControl()).toBe("select"));
    fireEvent.mouseDown(within(screen.getByTestId("total-form-field-kind")).getByRole("combobox"));
    const options = await screen.findAllByTestId(/^total-form-field-kind-option-/u);
    expect(options.map((option) => option.textContent)).toEqual([
      copy.labels.kind.PERCENTAGE,
      copy.labels.kind.FIXED_AMOUNT,
      copy.labels.kind.COMBO,
      copy.labels.kind.FREE_UNITS,
    ]);
  });

  it("Q2: picking Combo there switches the form exactly as the toggle does", async () => {
    containerWidth(288);
    renderForm();
    await waitFor(() => expect(kindControl()).toBe("select"));
    await chooseKindFromSelect("COMBO");
    await waitFor(() => expect(screen.getByTestId("combo-slots")).toBeTruthy());
    expect(screen.queryAllByTestId("total-form-field-scope")).toHaveLength(0);
  });

  it("Q3: a wide form keeps the four-part toggle", async () => {
    containerWidth(900);
    renderForm();
    await waitFor(() => expect(screen.getByTestId("total-form-field-kind-item-COMBO")).toBeTruthy());
    expect(kindControl()).toBe("toggle");
  });

  it("Q4: a legacy bundle price, five kinds, needs more room before it is a toggle", async () => {
    containerWidth(600);
    renderForm(
      record({ type: "BUNDLE_PRICE", scope: "COMBO", percentOffBp: null, bundlePriceCents: 2_500 }),
    );
    await waitFor(() => expect(kindControl()).toBe("select"));
  });

  it("Q5: the select still paints the kind's refusal", async () => {
    containerWidth(288);
    renderForm(record({ scope: "COMBO", comboRequirements: [] }));
    await waitFor(() => expect(kindControl()).toBe("select"));
    submit();
    await waitFor(() => expect(fieldMessage("kind")).toBe(copy.form.comboSlotsRequired));
  });
});

describe("FUT-4155: the schedule's refusal is said on the schedule", () => {
  function scheduleMessage(): string | null {
    return screen.queryByTestId("schedule-builder-message")?.textContent ?? null;
  }

  it("S1: no day chosen", async () => {
    const { sent } = renderForm();
    fillValid();
    fireEvent.click(screen.getByTestId("repetition-specific"));
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.daysRequired));
    expect(sent).toHaveLength(0);
  });

  it("S2: a window that starts when it ends", async () => {
    renderForm();
    fillValid();
    fireEvent.click(screen.getByTestId("repetition-specific"));
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetEveryDay}`));
    type("schedule-to-0", "1600");
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.timesRequired));
  });

  it("S3: the refusal clears once the schedule is edited, like a field's", async () => {
    renderForm();
    fillValid();
    fireEvent.click(screen.getByTestId("repetition-specific"));
    submit();
    await waitFor(() => expect(scheduleMessage()).toBe(copy.schedule.daysRequired));
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetWeekdays}`));
    await waitFor(() => expect(screen.queryAllByTestId("schedule-builder-message")).toHaveLength(0));
  });

  it("S4: a combo with no groups is refused on the kind, which paints it", async () => {
    renderForm(record({ scope: "COMBO", comboRequirements: [] }));
    submit();
    await waitFor(() => expect(fieldMessage("kind")).toBe(copy.form.comboSlotsRequired));
  });

  it("S5: leve 3 pague 2 with no product is refused on the kind in its own words", async () => {
    renderForm(
      record({ type: "FREE_UNITS", scope: "COMBO", percentOffBp: null, freeUnits: 1, comboRequirements: [] }),
    );
    submit();
    await waitFor(() => expect(fieldMessage("kind")).toBe(copy.form.freeUnitsTargetRequired));
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
    await waitFor(() => expect(screen.getByTestId("total-form-error-snackbar")).toBeTruthy());
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
    fireEvent.click(screen.getByTestId("repetition-specific"));
    type("schedule-from-0", "0900");
    type("schedule-from-0", "1:00");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("1:00"));
    expect(screen.queryAllByTestId("schedule-from-0-message")).toHaveLength(0);
    fireEvent.blur(input("schedule-from-0"));
    await waitFor(() =>
      expect(screen.getByTestId("schedule-from-0-message").textContent).toBe(
        "Termine o horário: HH:MM.",
      ),
    );
    type("schedule-from-0", "15:00");
    await waitFor(() => expect(screen.queryAllByTestId("schedule-from-0-message")).toHaveLength(0));
  });

  it("I4: at Criar the schedule says the time is unfinished, not that the ends must differ", async () => {
    const { sent } = renderForm();
    fillValid();
    fireEvent.click(screen.getByTestId("repetition-specific"));
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetEveryDay}`));
    type("schedule-from-0", "1:00");
    submit();
    await waitFor(() =>
      expect(screen.getByTestId("schedule-builder-message").textContent).toBe(
        copy.schedule.timeIncomplete,
      ),
    );
    expect(sent).toHaveLength(0);
  });

  it("I5: the en-US pack says both in English", () => {
    expect(EN_US_DISCOUNTS_WEB_COPY.form.dateIncomplete).toBe("Finish the date: DD/MM/YYYY.");
    expect(EN_US_DISCOUNTS_WEB_COPY.schedule.timeIncomplete).toBe("Finish the time: HH:MM.");
  });
});
