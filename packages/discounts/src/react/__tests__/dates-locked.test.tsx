// @vitest-environment jsdom
// The two surfaces `UsableModal` fetches on its first open, loaded up front so
// a cold worker's chunk import is not what the `findBy` waits on.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";
import { ThemeProvider } from "@12-apps/ui/mui/styles";

import type { DiscountWireRecord } from "../api";
import { createWebDiscounts } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { browserRootFontForThisFile, STILL_THEME } from "./still-theme";

/**
 * FUT-4482, review round 8 (B2): under an unknown zone the dates are locked
 * and everything else saves. A legacy row is read with its UTC days AND
 * `datesLocked`: the form shows those days in the disabled calendar and boxes,
 * says the amber notice, and Salvar sends `keepWindow` with no dates — so a
 * pause saves and the stored window is never touched.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const SURFACE_LOADED = { timeout: 10_000 };

const LOCKED: DiscountWireRecord = {
  id: "d-1",
  name: "Semana do hambúrguer",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  startsAt: "2026-11-10T00:00:00.000Z",
  endsAt: "2026-11-20T00:00:00.000Z",
  startsOn: "2026-11-10",
  endsOn: "2026-11-20",
  datesLocked: true,
  minSubtotalCents: null,
  usageLimit: null,
  perBuyerLimit: null,
  usageCount: 0,
  stackable: true,
  active: true,
  categoryIds: [],
  menuItemIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
};

function mount(rows: DiscountWireRecord[]): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  const transport: DiscountsTransport = {
    get: <T,>(url: string): Promise<T> =>
      url.endsWith("/targets")
        ? Promise.resolve({ data: STORY_GROUPS } as T)
        : Promise.resolve({
            data: rows,
            pagination: { page: 1, pageSize: 20, total: rows.length, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
          } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.push(body as Record<string, unknown>);
      return Promise.resolve({ ok: true, data: { id: "d-1" } as T });
    },
  };
  const { Screen } = createWebDiscounts({
    apiBase: "/api/admin/loja",
    copy,
    locale: "pt-BR",
    currency: "BRL",
    currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
    onError: () => {},
    transport,
    wholeDays: true,
  });
  render(
    <ThemeProvider theme={STILL_THEME}>
      <MemoryRouter initialEntries={["/discounts"]}>
        <Screen />
      </MemoryRouter>
    </ThemeProvider>,
  );
  return sent;
}

async function openEdit(id: string): Promise<HTMLElement> {
  const kebab = await screen.findAllByTestId(`discount-actions-${id}`, undefined, SURFACE_LOADED);
  fireEvent.click(within(kebab[0]!).queryByRole("button") ?? kebab[0]!);
  fireEvent.click(await screen.findByTestId("discount-action-edit"));
  return screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

const box = (period: HTMLElement, name: "startsAt" | "endsAt"): HTMLInputElement => {
  const field = within(period).getByTestId(`total-form-field-${name}`);
  return (field.querySelector("input") ?? field) as HTMLInputElement;
};

// The worker's first mount of the admin and its form pays for emotion writing
// every style once (1–1.5 s alone, several times that on a loaded runner).
// Paid here, under the hook's own limit, not inside the first case (FUT-4623).
browserRootFontForThisFile();

beforeAll(async () => {
  mount([LOCKED]);
  await openEdit(LOCKED.id);
  cleanup();
});

describe("a legacy row read with datesLocked (review round 8)", () => {
  // Round 9: the boxes are read-only rather than disabled, so the days read
  // in the input's ink (dates-locked-round-nine); they still change nothing.
  it("shows its days in the locked boxes and the disabled calendar, under the locked notice", async () => {
    mount([LOCKED]);
    const period = await openEdit(LOCKED.id);
    expect([box(period, "startsAt").value, box(period, "endsAt").value]).toEqual(["10/11/2026", "20/11/2026"]);
    expect(box(period, "startsAt").readOnly).toBe(true);
    expect(box(period, "endsAt").readOnly).toBe(true);
    const days = within(period).getAllByRole("gridcell").filter((cell) => cell.getAttribute("data-in-month") === "true");
    expect(days.every((cell) => cell.getAttribute("aria-disabled") === "true")).toBe(true);
    fireEvent.click(days[14]!);
    expect([box(period, "startsAt").value, box(period, "endsAt").value]).toEqual(["10/11/2026", "20/11/2026"]);
    expect(within(period).getByTestId("discount-days-unknown").textContent).toContain(copy.window.datesLockedForm);
    expect(within(period).getByTestId("discount-period-unavailable").textContent).toBe(copy.window.datesLockedBoxes);
    expect(period.textContent).not.toContain(copy.schedule.periodHint);
  });

  it("keeps every other field editable", async () => {
    mount([LOCKED]);
    await openEdit(LOCKED.id);
    expect((screen.getByLabelText(copy.form.name) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(copy.form.percentOff) as HTMLInputElement).disabled).toBe(false);
  });

  it("pauses: Salvar sends keepWindow and no dates, and closes", async () => {
    const sent = mount([LOCKED]);
    await openEdit(LOCKED.id);
    const active = screen.getByTestId("discount-active");
    fireEvent.click(active.querySelector("input") ?? active);
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(screen.queryAllByTestId("discount-form")).toHaveLength(0), SURFACE_LOADED);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ active: false, keepWindow: true });
    expect(sent[0]).not.toHaveProperty("startsAt");
    expect(sent[0]).not.toHaveProperty("endsAt");
  });

  it("says the locked words in both packs, never 'no dates'", () => {
    expect(copy.window.datesLockedBoxes).toBe("Datas bloqueadas: veja o aviso acima.");
    expect(EN_US_DISCOUNTS_WEB_COPY.window.datesLockedBoxes).toBe("Dates locked: see the notice above.");
    expect(EN_US_DISCOUNTS_WEB_COPY.window.datesLockedForm).toContain("Saving keeps the saved dates");
  });
});
