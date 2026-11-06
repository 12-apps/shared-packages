// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { missingWebCopy } from "../copy";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * FUT-4156 / FUT-4482, review round 1: whether equal days are legal follows the
 * SERVER (`wholeDays`, set where the host passes `storeTimeZone`), in the boxes
 * and in the calendar alike; a tap the form completes keeps the grid and the
 * focus where they were; and an edit opens on the record's own month, read
 * from the days the server sent rather than from the instants.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const sent: { bodies: unknown[] } = { bodies: [] };

function Plain({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

function openForm(window: Partial<DiscountWireRecord>, wholeDays = false): void {
  sent.bodies = [];
  const transport: DiscountsTransport = {
    get: <T,>(): Promise<T> => Promise.resolve({ data: STORY_GROUPS } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.bodies.push(body);
      return Promise.resolve({ ok: true, data: null as T });
    },
  };
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={Plain}
      groups={STORY_GROUPS}
      editing={{
        id: "d-1",
        name: "Semana do hambúrguer",
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
        createdAt: "2026-11-01T00:00:00.000Z",
        ...window,
      }}
      onSaved={vi.fn()}
      onError={() => {}}
      wholeDays={wholeDays}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const box = (name: "startsAt" | "endsAt"): HTMLInputElement =>
  screen.getByTestId(`total-form-field-${name}`) as HTMLInputElement;
const period = (): HTMLElement => screen.getByTestId("discount-period");
const cellOf = (day: number, month = "novembro", year = 2026): HTMLElement => {
  const cell = within(period()).queryAllByRole("gridcell", { name: `${day} de ${month} de ${year}` })[0];
  if (cell === undefined) throw new Error(`no ${day} de ${month} de ${year} on screen`);
  return cell;
};
const typeInto = (name: "startsAt" | "endsAt", value: string): void => {
  fireEvent.change(box(name), { target: { value } });
};
const monthsShown = (): string[] =>
  within(period())
    .getAllByRole("grid")
    .map((grid) => grid.getAttribute("aria-label") ?? "");
const STARTS_10_11 = { startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" };

describe("Início = Término follows the server (wholeDays)", () => {
  it("W1: without whole days, a second tap on Início does nothing", async () => {
    openForm(STARTS_10_11);
    fireEvent.click(cellOf(10));
    await waitFor(() => expect(box("startsAt").value).toBe("10/11/2026"));
    expect(box("endsAt").value).toBe("");
  });

  it("W2: with whole days, a second tap on Início is a one-day promotion", async () => {
    openForm(STARTS_10_11, true);
    fireEvent.click(cellOf(10));
    await waitFor(() => expect(box("endsAt").value).toBe("10/11/2026"));
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-10" });
  });

  it("W3: without whole days, equal typed days are refused on Término and never sent", async () => {
    openForm(STARTS_10_11);
    typeInto("endsAt", "10112026");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("total-form-field-endsAt-message").textContent).toBe(copy.form.endsBeforeStarts),
    );
    expect(sent.bodies).toEqual([]);
  });

  it("W4: with whole days, equal typed days are sent, and an earlier Término is refused", async () => {
    openForm(STARTS_10_11, true);
    typeInto("endsAt", "09112026");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("total-form-field-endsAt-message").textContent).toBe(copy.form.endsBeforeStartDay),
    );
    typeInto("endsAt", "10112026");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-10" });
  });
});

describe("a tap the form completes (Término kept)", () => {
  it("W5: keeps the grid on its month and focus on the tapped day", async () => {
    openForm({ startsOn: null, endsOn: "2026-12-20", startsAt: null, endsAt: "2026-12-21T03:00:00.000Z" });
    await waitFor(() => expect(monthsShown()[0]).toBe("dezembro de 2026"));
    fireEvent.click(within(period()).getAllByRole("button", { name: "Mês anterior" })[0]!);
    expect(monthsShown()[0]).toBe("novembro de 2026");

    const tapped = cellOf(10);
    fireEvent.click(tapped);

    await waitFor(() => expect(box("startsAt").value).toBe("10/11/2026"));
    expect(box("endsAt").value).toBe("20/12/2026");
    expect(monthsShown()[0]).toBe("novembro de 2026");
    // The very node tapped is still the one on screen: nothing remounted the
    // grid under it, so its focus (proved in @12-apps/ui) has nowhere to go.
    expect(tapped.isConnected).toBe(true);
  });
});

describe("the edit form opens on the record's month", () => {
  it("W6: reads the month from the day the server sent, not from the UTC instant", () => {
    // Tokyo: 01/02/2027 starts at 15:00Z on 31/01, a January instant.
    openForm({ startsOn: "2027-02-01", endsOn: "2027-02-14", startsAt: "2027-01-31T15:00:00.000Z", endsAt: "2027-02-14T15:00:00.000Z" }, true);
    expect(monthsShown()[0]).toBe("fevereiro de 2027");
    expect(box("startsAt").value).toBe("01/02/2027");
  });

  it("W7: with only Término, opens on Término's month", () => {
    openForm({ startsOn: null, endsOn: "2027-03-15", startsAt: null, endsAt: "2027-03-16T03:00:00.000Z" }, true);
    expect(monthsShown()[0]).toBe("março de 2027");
  });
});

describe("the calendar as prototype B draws it", () => {
  it("W8: shows only the month's own days", () => {
    openForm(STARTS_10_11);
    const outside = within(period())
      .getAllByRole("gridcell")
      .filter((day) => day.getAttribute("data-in-month") !== "true");
    expect(outside).toHaveLength(0);
  });

  it("W9: names its months in the copy's own language", () => {
    openForm(STARTS_10_11);
    expect(monthsShown()[0]).toBe("novembro de 2026");
  });

  // Review round 6: edited on purpose. Required, these names made the branch a
  // breaking change for every host pack; optional, a pack without them is
  // filled from the package's pack for the host's locale — still never English
  // on a Portuguese host (see days-unknown-fallback.test.tsx).
  it("W10: a pack without the calendar's names is not reported missing: it is filled in", () => {
    const form = Object.fromEntries(Object.entries(copy.form).filter(([key]) => key !== "calendar"));
    expect(missingWebCopy({ ...copy, form } as unknown as typeof copy, copy)).toEqual([]);
  });
});

describe("a tap with only Término chosen, as prototype B's pick() does it", () => {
  // B (`Quando.dc.html`, pick): with Término alone, a tap before it is Início
  // and Término stays (W5); a tap ON or AFTER it is a new Início and Término
  // is cleared — `e: (ek && !sk && ek > k) ? st.e : ''`.
  const ENDS_20_11 = { startsOn: null, endsOn: "2026-11-20", startsAt: null, endsAt: "2026-11-21T03:00:00.000Z" };

  it("W11: a tap on Término's own day makes it Início and clears Término", async () => {
    openForm(ENDS_20_11, true);
    fireEvent.click(cellOf(20));
    await waitFor(() => expect(box("startsAt").value).toBe("20/11/2026"));
    expect(box("endsAt").value).toBe("");
  });

  it("W12: a tap after Término makes it Início and clears Término", async () => {
    openForm(ENDS_20_11, true);
    fireEvent.click(cellOf(25));
    await waitFor(() => expect(box("startsAt").value).toBe("25/11/2026"));
    expect(box("endsAt").value).toBe("");
  });
});

describe("the frame meets the section's edges (round 2)", () => {
  it("W13: spans the section rather than hugging its month", () => {
    openForm(STARTS_10_11);
    const frame = within(period()).getByTestId("calendar-container").parentElement!.parentElement!;
    expect(getComputedStyle(frame).alignSelf).toBe("stretch");
    expect(getComputedStyle(within(period()).getByTestId("calendar-container")).width).toBe("100%");
  });
});
