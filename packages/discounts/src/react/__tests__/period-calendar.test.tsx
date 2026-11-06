// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * FUT-4156, approved option B: "Quando vale" carries a range calendar that is
 * ALWAYS open, the DD/MM/AAAA boxes beside it on a computer and under it on a
 * phone, and the two stay in step. A tap before Início becomes the new Início;
 * one tapped day is a promotion with no end.
 *
 * Every case opens on a rule that starts in November 2026, so the calendar's
 * month is a fact of the test, never of the day it runs on.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const sent: { bodies: unknown[] } = { bodies: [] };

function Plain({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

function openForm(window: Partial<DiscountWireRecord>): void {
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
    />,
  );
}

/** Every element measured reports `width` px. */
function formWidth(width: number): void {
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

const box = (name: "startsAt" | "endsAt"): HTMLInputElement =>
  screen.getByTestId(`total-form-field-${name}`) as HTMLInputElement;
const period = (): HTMLElement => screen.getByTestId("discount-period");
const tap = (day: number, month = "novembro", year = 2026): void => {
  const cell = within(period()).getAllByRole("gridcell", { name: `${day} de ${month} de ${year}` })[0];
  if (cell === undefined) throw new Error(`no ${day} de ${month} de ${year} on screen`);
  fireEvent.click(cell);
};
const typeInto = (name: "startsAt" | "endsAt", value: string): void => {
  fireEvent.change(box(name), { target: { value } });
};

describe("FUT-4156 option B: the calendar is always open in Quando vale", () => {
  it("B1: draws the month grid with no button to open it, and names its arrows", () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    expect(within(period()).getAllByRole("grid").length).toBeGreaterThan(0);
    expect(within(period()).getAllByRole("button", { name: "Mês anterior" }).length).toBeGreaterThan(0);
    expect(within(period()).getAllByRole("button", { name: "Próximo mês" }).length).toBeGreaterThan(0);
  });

  it("B2: a later tap after Início is Término; a tap on a finished range starts again", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    tap(20);
    await waitFor(() => expect(box("endsAt").value).toBe("20/11/2026"));
    expect(box("startsAt").value).toBe("10/11/2026");
    tap(12);
    await waitFor(() => expect(box("startsAt").value).toBe("12/11/2026"));
    expect(box("endsAt").value).toBe("");
  });

  it("B3: a tap BEFORE Início becomes the new Início, and the old Início Término", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    tap(8);
    await waitFor(() => expect(box("startsAt").value).toBe("08/11/2026"));
    expect(box("endsAt").value).toBe("10/11/2026");
  });

  it("B4: one tapped day is a promotion with no end", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: "2026-11-20", startsAt: "2026-11-10T03:00:00.000Z", endsAt: "2026-11-21T03:00:00.000Z" });
    tap(14);
    await waitFor(() => expect(box("startsAt").value).toBe("14/11/2026"));
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent.bodies).toHaveLength(1));
    expect(sent.bodies[0]).toMatchObject({ startsAt: "2026-11-14", endsAt: null });
  });

  it("B5: Término typed alone, an earlier tap is Início and Término is kept", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    typeInto("startsAt", "");
    typeInto("endsAt", "20112026");
    await waitFor(() => expect(box("endsAt").value).toBe("20/11/2026"));
    tap(10);
    await waitFor(() => expect(box("startsAt").value).toBe("10/11/2026"));
    expect(box("endsAt").value).toBe("20/11/2026");
  });

  it("B6: a typed Início moves the calendar to its month", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    typeInto("startsAt", "10012027");
    await waitFor(() =>
      expect(within(period()).getAllByRole("gridcell", { name: "10 de janeiro de 2027" }).length).toBeGreaterThan(0),
    );
  });

  it("B7: a half-typed box is kept as typed when a day elsewhere is tapped", async () => {
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    typeInto("startsAt", "");
    typeInto("endsAt", "2011");
    tap(12);
    await waitFor(() => expect(box("startsAt").value).toBe("12/11/2026"));
    expect(box("endsAt").value).toBe("20/11");
  });

  it("B8: on a computer the boxes sit beside the months; on a phone, under them", () => {
    formWidth(1100);
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    expect(period().querySelector("[data-fields-placement]")?.getAttribute("data-fields-placement")).toBe("beside");
  });

  it("B9: on a phone the boxes sit under the single month", () => {
    formWidth(358);
    openForm({ startsOn: "2026-11-10", endsOn: null, startsAt: "2026-11-10T03:00:00.000Z" });
    expect(period().querySelector("[data-fields-placement]")?.getAttribute("data-fields-placement")).toBe("below");
    expect(within(period()).getAllByRole("grid")).toHaveLength(1);
  });
});
