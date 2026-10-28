// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import type { DiscountsWebCopy } from "../copy";
import { DiscountForm } from "../discount-form";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * The discounts form on a Brazilian screen (FUT-4143).
 *
 * Four things did not belong there: an English banner after a failed submit, a
 * percentage judged only once the name was fixed, a clock that followed the
 * BROWSER's language instead of the page's, and a limit where "2,5" was stored
 * as 25. Each case is named after what the merchant sees.
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

/** A transport whose every write the SERVER refuses, with a sentence of its own. */
function refusingTransport(): DiscountsTransport {
  return {
    ...recordingTransport().transport,
    send: <T,>(): Promise<DiscountsResult<T>> =>
      Promise.resolve({ ok: false, error: "Já existe um cupom com esse código." }),
  };
}

function renderForm(
  editing: DiscountWireRecord | null = null,
  pack: DiscountsWebCopy = copy,
  refusing = false,
): { sent: unknown[] } {
  const recording = recordingTransport();
  const sent = recording.sent;
  const transport = refusing ? refusingTransport() : recording.transport;
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={pack}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={editing}
      onSaved={vi.fn()}
      onError={() => {}}
    />,
  );
  return { sent };
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
    comboRequirements: [{ menuItemIds: [], categoryIds: ["c-sodas"], quantity: 2 }],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A "leve 3, pague 2" rule. */
function freeUnitsRecord(): DiscountWireRecord {
  return comboRecord({
    type: "FREE_UNITS",
    percentOffBp: null,
    freeUnits: 1,
    comboRequirements: [{ menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 }],
  });
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

/** The message a bound field paints under itself, or null. */
function fieldMessage(name: string): string | null {
  return screen.queryByTestId(`total-form-field-${name}-message`)?.textContent ?? null;
}

/** A valid percentage promotion, so a case fails on its own field only. */
function fillValidPercentage(): void {
  type("total-form-field-name", "Happy hour");
  type("total-form-field-percentOff", "10");
}

describe("the banner after a failed submit speaks the form's language", () => {
  it("B1: pt-BR — 'Corrija os campos destacados e tente novamente.'", async () => {
    renderForm();
    submit();
    const banner = await screen.findByTestId("total-form-error-snackbar");
    expect(banner.textContent).toContain("Corrija os campos destacados e tente novamente.");
    expect(banner.textContent).not.toContain("Please fix");
  });

  it("B2: the sentence comes from the pack, so en-US says it in English", async () => {
    renderForm(null, EN_US_DISCOUNTS_WEB_COPY);
    submit();
    const banner = await screen.findByTestId("total-form-error-snackbar");
    expect(banner.textContent).toContain(EN_US_DISCOUNTS_WEB_COPY.form.errorSnackbar);
  });
});

describe("one message per failure", () => {
  it("M1: a client refusal shows the toast and the red fields, NOT the saveFailed alert", async () => {
    renderForm();
    type("total-form-field-percentOff", "150");
    submit();
    const banner = await screen.findByTestId("total-form-error-snackbar");
    expect(banner.textContent).toContain("Corrija os campos destacados e tente novamente.");
    expect(fieldMessage("name")).toBe(copy.form.nameRequired);
    expect(fieldMessage("percentOff")).toBe(copy.form.invalidPercent);
    expect(screen.queryAllByTestId("discount-form-error")).toHaveLength(0);
    expect(document.body.textContent).not.toContain(copy.form.saveFailed);
  });

  it("M2: a server refusal still shows the saveFailed alert with the server's reason", async () => {
    renderForm(null, copy, true);
    fillValidPercentage();
    submit();
    const alert = await screen.findByTestId("discount-form-error");
    expect(alert.textContent).toContain(copy.form.saveFailed);
    expect(alert.textContent).toContain("Já existe um cupom com esse código.");
  });
});

describe("every field is judged in one pass", () => {
  it("P1: an empty name and a 150% are BOTH red after one Criar", async () => {
    const { sent } = renderForm();
    type("total-form-field-percentOff", "150");
    submit();
    await waitFor(() => expect(fieldMessage("name")).toBe(copy.form.nameRequired));
    expect(fieldMessage("percentOff")).toBe(copy.form.invalidPercent);
    expect(input("total-form-field-percentOff").getAttribute("aria-invalid")).toBe("true");
    expect(sent).toHaveLength(0);
  });

  it.each([["empty", ""], ["zero", "0"], ["negative", "-5"], ["above 100", "100,5"]])(
    "P2: a percentage that is %s is red with invalidPercent",
    async (_label, typed) => {
      renderForm();
      type("total-form-field-name", "Happy hour");
      type("total-form-field-percentOff", typed);
      submit();
      await waitFor(() => expect(fieldMessage("percentOff")).toBe(copy.form.invalidPercent));
    },
  );

  it("P3: 100% and 12,5% are accepted", async () => {
    const { sent } = renderForm();
    type("total-form-field-name", "Happy hour");
    type("total-form-field-percentOff", "12,5");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(fieldMessage("percentOff")).toBeNull();
  });

  it("P4: a one-letter name is refused in the pack's words, not forms-core's English", async () => {
    renderForm();
    type("total-form-field-name", "A");
    type("total-form-field-percentOff", "10");
    submit();
    await waitFor(() => expect(fieldMessage("name")).toBe(copy.form.nameTooShort));
    expect(copy.form.nameTooShort).not.toMatch(/characters/u);
  });
});

describe("Desconto (%) opens a decimal keypad", () => {
  it("K1: inputmode=decimal on the <input> of a plain percentage", () => {
    renderForm();
    expect(input("total-form-field-percentOff").getAttribute("inputmode")).toBe("decimal");
  });

  it("K2: and on a combo's percentage", () => {
    renderForm(comboRecord());
    expect(input("total-form-field-percentOff").getAttribute("inputmode")).toBe("decimal");
  });
});

describe("Das / às are 24-hour text fields", () => {
  function openSchedule(): void {
    renderForm();
    fireEvent.click(screen.getByTestId("repetition-specific"));
  }

  it("C1: no type=time — a masked text field with a numeric keypad", () => {
    openSchedule();
    for (const id of ["schedule-from-0", "schedule-to-0"]) {
      expect(input(id).getAttribute("type")).toBe("text");
      expect(input(id).getAttribute("inputmode")).toBe("numeric");
      expect(input(id).getAttribute("placeholder")).toBe("00:00");
    }
  });

  it("C2: four digits become HH:MM as they are typed", async () => {
    openSchedule();
    type("schedule-from-0", "1830");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("18:30"));
    type("schedule-to-0", "23:5999");
    await waitFor(() => expect(input("schedule-to-0").value).toBe("23:59"));
  });

  it("C3: 25:00 is marked as an hour that does not exist", async () => {
    openSchedule();
    type("schedule-from-0", "2500");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("25:00"));
    expect(input("schedule-from-0").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("schedule-from-0-message").textContent).toBe(
      copy.schedule.invalidTime,
    );
  });

  it("C4: 12:60 is marked too; a half-typed hour is not shouted at", async () => {
    openSchedule();
    type("schedule-to-0", "1260");
    await waitFor(() =>
      expect(screen.getByTestId("schedule-to-0-message").textContent).toBe(
        copy.schedule.invalidTime,
      ),
    );
    type("schedule-from-0", "9");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("9"));
    expect(input("schedule-from-0").getAttribute("aria-invalid")).toBe("false");
    expect(screen.getAllByTestId(/^schedule-.*-message$/u)).toHaveLength(1);
  });

  it("C5: a real hour is what the rule saves", async () => {
    const { sent } = renderForm();
    fillValidPercentage();
    fireEvent.click(screen.getByTestId("repetition-specific"));
    fireEvent.click(screen.getByTestId(`schedule-preset-${copy.schedule.presetEveryDay}`));
    type("schedule-from-0", "0730");
    type("schedule-to-0", "1100");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0] as { schedule: { windows: { from: string; to: string }[] } };
    expect(body.schedule.windows[0]).toMatchObject({ from: "07:30", to: "11:00" });
  });
});

describe("the counts take whole numbers only", () => {
  it.each(["usageLimit", "perBuyerLimit"])(
    "W1: %s has a numeric keypad and is not type=number",
    (name) => {
      renderForm();
      const field = input(`total-form-field-${name}`);
      expect(field.getAttribute("type")).toBe("text");
      expect(field.getAttribute("inputmode")).toBe("numeric");
    },
  );

  it.each([
    ["usageLimit", () => copy.form.invalidUsageLimit],
    ["perBuyerLimit", () => copy.form.invalidPerBuyerLimit],
  ])("W2: '2,5' in %s is refused with a message and never sent", async (name, message) => {
    const { sent } = renderForm();
    fillValidPercentage();
    type(`total-form-field-${name}`, "2,5");
    submit();
    await waitFor(() => expect(fieldMessage(name)).toBe(message()));
    expect(sent).toHaveLength(0);
  });

  it("W3: '0' and '1.5' are refused as well; '3' is sent as 3", async () => {
    const { sent } = renderForm();
    fillValidPercentage();
    type("total-form-field-usageLimit", "0");
    type("total-form-field-perBuyerLimit", "1.5");
    submit();
    await waitFor(() => expect(fieldMessage("usageLimit")).toBe(copy.form.invalidUsageLimit));
    expect(fieldMessage("perBuyerLimit")).toBe(copy.form.invalidPerBuyerLimit);
    type("total-form-field-usageLimit", "3");
    type("total-form-field-perBuyerLimit", "");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ usageLimit: 3, perBuyerLimit: null });
  });

  it("W4: Combos por pedido has a numeric keypad and refuses '2,5'", async () => {
    const { sent } = renderForm(comboRecord());
    const cap = input("total-form-field-maxComboApplications");
    expect(cap.getAttribute("type")).toBe("text");
    expect(cap.getAttribute("inputmode")).toBe("numeric");
    type("total-form-field-maxComboApplications", "2,5");
    submit();
    await waitFor(() =>
      expect(fieldMessage("maxComboApplications")).toBe(copy.form.invalidMaxComboApplications),
    );
    expect(sent).toHaveLength(0);
  });

  it("W5: Vezes por pedido (leve 3, pague 2) refuses '2,5' too", async () => {
    const { sent } = renderForm(freeUnitsRecord());
    type("total-form-field-maxComboApplications", "2,5");
    submit();
    await waitFor(() =>
      expect(fieldMessage("maxComboApplications")).toBe(copy.form.invalidMaxComboApplications),
    );
    expect(sent).toHaveLength(0);
  });

  it("W6: Itens grátis has a numeric keypad and refuses '2,5' with a message", async () => {
    const { sent } = renderForm(freeUnitsRecord());
    const free = input("free-units-free");
    expect(free.getAttribute("type")).toBe("text");
    expect(free.getAttribute("inputmode")).toBe("numeric");
    type("free-units-free", "2,5");
    submit();
    await waitFor(() =>
      expect(screen.getByTestId("free-units-free-message").textContent).toBe(
        copy.form.invalidFreeUnits,
      ),
    );
    expect(sent).toHaveLength(0);
  });

  it("W7: O cliente leva refuses '2,5' on the spot and never shows NaN", async () => {
    const { sent } = renderForm(freeUnitsRecord());
    const taken = input("free-units-quantity");
    expect(taken.getAttribute("type")).toBe("text");
    expect(taken.getAttribute("inputmode")).toBe("numeric");
    type("free-units-quantity", "2,5");
    await waitFor(() => expect(taken.value).toBe("2,5"));
    expect(taken.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("free-units-quantity-message").textContent).toBe(
      copy.form.wholeNumberOnly,
    );
    submit();
    await waitFor(() => expect(screen.getByTestId("total-form-error-snackbar")).toBeTruthy());
    expect(sent).toHaveLength(0);
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("W8: a group's Quantidade refuses '2,5' on the spot and a whole number clears it", async () => {
    renderForm(comboRecord());
    const quantity = input("combo-slot-0-quantity");
    expect(quantity.getAttribute("type")).toBe("text");
    expect(quantity.getAttribute("inputmode")).toBe("numeric");
    type("combo-slot-0-quantity", "2,5");
    await waitFor(() =>
      expect(screen.getByTestId("combo-slot-0-quantity-message").textContent).toBe(
        copy.form.wholeNumberOnly,
      ),
    );
    expect(document.body.textContent).not.toContain("NaN");
    type("combo-slot-0-quantity", "4");
    await waitFor(() => expect(quantity.value).toBe("4"));
    await waitFor(() => expect(screen.queryByTestId("combo-slot-0-quantity-message")).toBeNull());
  });

  it("W9: a whole quantity still reaches the write", async () => {
    const { sent } = renderForm(comboRecord());
    type("combo-slot-0-quantity", "3");
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      comboRequirements: [{ categoryIds: ["c-sodas"], menuItemIds: [], quantity: 3 }],
    });
  });
});

describe("a count box always shows the state it holds", () => {
  /** A combo of two groups, 2 and 3 units. */
  function twoGroups(): DiscountWireRecord {
    return comboRecord({
      comboRequirements: [
        { menuItemIds: [], categoryIds: ["c-sodas"], quantity: 2 },
        { menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 },
      ],
    });
  }

  it("R1: removing a group does not hand its draft to the group below", async () => {
    const { sent } = renderForm(twoGroups());
    type("combo-slot-1-quantity", "");
    fireEvent.click(screen.getByTestId("combo-slot-0-remove"));
    await waitFor(() => expect(screen.queryAllByTestId(/^combo-slot-\d+$/u)).toHaveLength(1));
    const survivor = input("combo-slot-0-quantity");
    expect(survivor.value).toBe("");
    expect(survivor.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("combo-slot-0-quantity-message").textContent).toBe(
      copy.form.invalidComboQuantity,
    );
    expect(screen.getByTestId("combo-summary").textContent).toBe("O combo leva 0 itens em 1 grupos.");
    submit();
    await waitFor(() => expect(screen.getByTestId("total-form-error-snackbar")).toBeTruthy());
    expect(sent).toHaveLength(0);
  });

  it("R2: the surviving group keeps its OWN draft", async () => {
    renderForm(twoGroups());
    type("combo-slot-1-quantity", "2,5");
    fireEvent.click(screen.getByTestId("combo-slot-0-remove"));
    await waitFor(() => expect(input("combo-slot-0-quantity").value).toBe("2,5"));
    expect(screen.getByTestId("combo-slot-0-quantity-message").textContent).toBe(
      copy.form.wholeNumberOnly,
    );
  });

  it("R3: the row ids stay on screen and never reach the wire", async () => {
    const { sent } = renderForm(twoGroups());
    fireEvent.click(screen.getByTestId("combo-slot-0-remove"));
    await waitFor(() => expect(input("combo-slot-0-quantity").value).toBe("3"));
    submit();
    await waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0] as { comboRequirements: Record<string, unknown>[] };
    expect(body.comboRequirements).toEqual([
      { menuItemIds: ["m-burger"], categoryIds: [], quantity: 3 },
    ]);
  });

  it("R4: Itens grátis marks '2,5' as it is typed, before any Criar", async () => {
    renderForm(freeUnitsRecord());
    type("free-units-free", "2,5");
    await waitFor(() =>
      expect(screen.getByTestId("free-units-free-message").textContent).toBe(
        copy.form.wholeNumberOnly,
      ),
    );
    expect(input("free-units-free").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("editing a clock in place", () => {
  function openSchedule(): void {
    renderForm();
    fireEvent.click(screen.getByTestId("repetition-specific"));
  }

  it("E1: '09:00', the hour selected and '1','5' typed, reads 15:00", async () => {
    openSchedule();
    type("schedule-from-0", "0900");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("09:00"));
    type("schedule-from-0", "1:00");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("1:00"));
    type("schedule-from-0", "15:00");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("15:00"));
  });

  it("E2: another separator typed over a whole time is read as the colon", async () => {
    openSchedule();
    type("schedule-to-0", "25/10");
    await waitFor(() => expect(input("schedule-to-0").value).toBe("25:10"));
    expect(screen.getByTestId("schedule-to-0-message").textContent).toBe(copy.schedule.invalidTime);
  });

  it("E3: a time with no colon yet is still masked from its digits", async () => {
    openSchedule();
    type("schedule-from-0", "");
    type("schedule-from-0", "16h30");
    await waitFor(() => expect(input("schedule-from-0").value).toBe("16:30"));
  });
});
