// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * Authoring a recurring promotion (FUT-996).
 *
 * The cases are named after what a merchant would say — "toda sexta, das 16 às
 * 20" — because that is what makes a regression legible. The property under
 * test throughout is the one the ticket argues for: **the form asks for a
 * schedule the way a promotion is described, and reads it back as a sentence
 * before it is saved.**
 *
 * The default is asserted first and hardest. A form that got harder for the
 * promotions nobody schedules would have failed regardless of how well the
 * builder works.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

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

function renderForm(editing: DiscountWireRecord | null = null) {
  const { transport, sent } = recordingTransport();
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
      timezoneLabel="Horário Padrão de Brasília"
    />,
  );
  return { sent };
}

/** Switch the form to "em dias e horários específicos". */
function chooseSpecificHours(): void {
  fireEvent.click(screen.getByTestId("repetition-specific"));
}

/** Click a weekday chip on one row, by the pack's own short label. */
function toggleDay(label: string, index = 0): void {
  fireEvent.click(screen.getByTestId(`schedule-day-${index}-${label}`));
}

function setTime(kind: "from" | "to", value: string, index = 0): void {
  fireEvent.change(screen.getByTestId(`schedule-${kind}-${index}`), { target: { value } });
}

/** Fill the name so the form's other rules do not mask a schedule failure. */
function nameIt(name = "Happy hour"): void {
  fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: name } });
}

/** A radio's checked state — jest-dom is not installed in this package. */
function checked(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLInputElement).checked;
}

async function submit(): Promise<void> {
  fireEvent.click(screen.getByTestId("discount-form-submit"));
}

describe("the default is unchanged", () => {
  it('opens on "Sempre", with no builder on screen', async () => {
    renderForm();
    expect(checked("repetition-always")).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("schedule-builder")).toBeNull());
  });

  it("sends schedule: null for an ordinary promotion", async () => {
    // The property that makes this change additive: an operator creating a
    // plain 10%-off must produce exactly the payload they always did.
    const { sent } = renderForm();
    nameIt("Dez por cento");
    fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
    await submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { schedule: unknown }).schedule).toBeNull();
  });
});

describe("toda sexta, das 16:00 às 20:00", () => {
  it("reads the promotion back as a sentence before it is saved", async () => {
    renderForm();
    chooseSpecificHours();
    toggleDay("Sex");
    setTime("from", "16:00");
    setTime("to", "20:00");
    // The single most valuable thing on this screen: the operator can check
    // what they built against what they meant.
    expect((await screen.findByTestId("schedule-summary-0")).textContent).toContain("Toda sexta, das 16:00 às 20:00.");
  });

  it("sends the schedule the sentence described", async () => {
    const { sent } = renderForm();
    nameIt();
    fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
    chooseSpecificHours();
    toggleDay("Sex");
    setTime("from", "16:00");
    setTime("to", "20:00");
    await submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { schedule: unknown }).schedule).toEqual({
      windows: [{ days: [4], from: "16:00", to: "20:00" }],
    });
  });
});

describe("the sentence only appears once it is a real offer", () => {
  it("says nothing with no day chosen", async () => {
    // Same rule the free-units builder follows: a sentence over a half-built
    // window would read as confirmation of something about to be refused.
    renderForm();
    chooseSpecificHours();
    await waitFor(() => expect(screen.queryByTestId("schedule-summary-0")).toBeNull());
  });

  it("says nothing when the two clocks are equal", async () => {
    renderForm();
    chooseSpecificHours();
    toggleDay("Sex");
    setTime("to", "16:00");
    await waitFor(() => expect(screen.queryByTestId("schedule-summary-0")).toBeNull());
  });

  it("spells out an overnight window rather than accepting it silently", () => {
    // A bar shutting at 02:00 is the commonest happy hour there is, so this is
    // not an error — but it IS ambiguous on screen until it says which day.
    renderForm();
    chooseSpecificHours();
    toggleDay("Sex");
    setTime("from", "22:00");
    setTime("to", "02:00");
    expect(screen.getByTestId("schedule-summary-0").textContent).toContain("Toda sexta, das 22:00 às 02:00 do dia seguinte.");
  });
});

describe("segunda e terça à tarde", () => {
  it("names both days in one sentence", () => {
    renderForm();
    chooseSpecificHours();
    toggleDay("Seg");
    toggleDay("Ter");
    setTime("from", "12:00");
    setTime("to", "18:00");
    expect(screen.getByTestId("schedule-summary-0").textContent).toContain("segunda e terça, das 12:00 às 18:00.");
  });
});

describe("the presets write into the chips", () => {
  it('collapses a full week into "Todos os dias"', () => {
    renderForm();
    chooseSpecificHours();
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetEveryDay}`));
    expect(screen.getByTestId("schedule-summary-0").textContent).toContain("Todos os dias, das");
  });

  it("leaves the operator free to deselect a day afterwards", async () => {
    // What makes a preset a shortcut rather than a fourth mode to understand.
    const { sent } = renderForm();
    nameIt();
    fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
    chooseSpecificHours();
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetWeekdays}`));
    toggleDay("Qua");
    await submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { schedule: { windows: { days: number[] }[] } }).schedule.windows[0]?.days)
      .toEqual([0, 1, 3, 4]);
  });
});

describe("several time rows", () => {
  it('adds a second row with "Adicionar outro horário"', async () => {
    const { sent } = renderForm();
    nameIt();
    fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
    chooseSpecificHours();
    toggleDay("Sex");
    setTime("from", "16:00");
    setTime("to", "20:00");
    fireEvent.click(screen.getByTestId("schedule-add-window"));
    toggleDay("Sáb", 1);
    setTime("from", "12:00", 1);
    setTime("to", "16:00", 1);
    await submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { schedule: { windows: unknown[] } }).schedule.windows).toEqual([
      { days: [4], from: "16:00", to: "20:00" },
      { days: [5], from: "12:00", to: "16:00" },
    ]);
  });
});

describe("what the form refuses", () => {
  it("will not save a schedule with no day chosen", async () => {
    const { sent } = renderForm();
    nameIt();
    fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
    chooseSpecificHours();
    await submit();
    await waitFor(() => expect(screen.getByTestId("discount-form-error")).toBeTruthy());
    expect(sent).toHaveLength(0);
  });
});

describe("editing a rule that already has a schedule", () => {
  const HAPPY_HOUR: DiscountWireRecord = {
    id: "d-hh",
    name: "Happy hour",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "CATEGORY",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
    schedule: { windows: [{ days: [4], from: "16:00", to: "20:00" }] },
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: true,
    active: true,
    categoryIds: ["c-sodas"],
    menuItemIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("opens on the schedule it was saved with", () => {
    renderForm(HAPPY_HOUR);
    expect(checked("repetition-specific")).toBe(true);
    expect(screen.getByTestId("schedule-summary-0").textContent).toContain("Toda sexta, das 16:00 às 20:00.");
  });

  it("keeps the rows when the operator toggles back to Sempre and returns", async () => {
    // The switch must not be destructive: an operator who changes their mind
    // twice has not lost the days they picked.
    renderForm(HAPPY_HOUR);
    fireEvent.click(screen.getByTestId("repetition-always"));
    await waitFor(() => expect(screen.queryByTestId("schedule-builder")).toBeNull());
    fireEvent.click(screen.getByTestId("repetition-specific"));
    expect(screen.getByTestId("schedule-summary-0").textContent).toContain("Toda sexta, das 16:00 às 20:00.");
  });

  it("drops the schedule when saved as Sempre", async () => {
    const { sent } = renderForm(HAPPY_HOUR);
    fireEvent.click(screen.getByTestId("repetition-always"));
    await submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { schedule: unknown }).schedule).toBeNull();
  });
});

describe("the timezone is named", () => {
  it("tells the operator whose 16:00 they are setting", () => {
    // Not rhetorical: a store admin sitting in another zone would otherwise be
    // setting hours in their own.
    renderForm();
    chooseSpecificHours();
    expect(screen.getByText("Fuso horário: Horário Padrão de Brasília.")).toBeTruthy();
  });

  it("states the price guarantee where the merchant makes it", () => {
    renderForm();
    chooseSpecificHours();
    expect(screen.getByText(copy.schedule.guaranteeNote)).toBeTruthy();
  });
});
