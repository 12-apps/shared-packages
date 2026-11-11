// @vitest-environment jsdom
// The two surfaces `UsableModal` fetches on its first open, loaded up front so
// a cold worker's chunk import is not what the `findBy` waits on.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";
import { ThemeProvider } from "@12-apps/ui/mui/styles";

import type { DiscountWireRecord } from "../api";
import { createWebDiscounts, type DiscountsWebConfig } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters, formatWindow } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { browserRootFontForThisFile, STILL_THEME } from "./still-theme";
import { findReach } from "./step-form-shim";

/**
 * FUT-4482, review rounds 4 and 5: a rule whose days the server cannot place
 * (`daysUnknown`, the store's zone is not one it knows). The edit form must
 * not read as "Salvar makes it never-ending": no open-ended hint, and an amber
 * notice that says the dates are unavailable and that saving keeps them.
 * Salvar is never refused for it (round 5, days-unknown-round-five.test.tsx).
 * The list says it once above the grid, short in the cell, and under the name
 * where the cell is off-screen.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const SURFACE_LOADED = { timeout: 10_000 };

const UNKNOWN: DiscountWireRecord = {
  id: "d-1",
  name: "Semana do hambúrguer",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  startsAt: "2026-11-09T15:00:00.000Z",
  endsAt: "2026-11-20T15:00:00.000Z",
  daysUnknown: true,
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

const PLACED: DiscountWireRecord = {
  ...UNKNOWN,
  id: "d-2",
  name: "Dia da pizza",
  daysUnknown: undefined,
  startsOn: "2026-11-10",
  endsOn: "2026-11-20",
};

function mount(rows: DiscountWireRecord[], extra: Partial<DiscountsWebConfig> = {}) {
  const sent: unknown[] = [];
  const transport: DiscountsTransport = {
    get: <T,>(url: string): Promise<T> =>
      url.endsWith("/targets")
        ? Promise.resolve({ data: STORY_GROUPS } as T)
        : Promise.resolve({
            data: rows,
            pagination: { page: 1, pageSize: 20, total: rows.length, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
          } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.push(body);
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
    ...extra,
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
  fireEvent.click(await findReach("discount-action-edit"));
  return findReach("discount-period", undefined, SURFACE_LOADED);
}

// The worker's first mount of the admin and its form pays for emotion writing
// every style once (1–1.5 s alone, several times that on a loaded runner).
// Paid here, under the hook's own limit, not inside the first case (FUT-4623).
browserRootFontForThisFile();

beforeAll(async () => {
  mount([UNKNOWN]);
  await openEdit(UNKNOWN.id);
  cleanup();
});

describe("the edit form of a rule whose days are unknown (review round 4)", () => {
  it("drops the open-ended hint and says what Salvar does", async () => {
    mount([UNKNOWN]);
    const period = await openEdit(UNKNOWN.id);
    expect(within(period).getByTestId("discount-days-unknown").textContent).toContain(copy.window.daysUnknownForm);
    expect(within(period).queryAllByText(copy.schedule.periodHint)).toHaveLength(0);
  });

  it("keeps the open-ended hint on a rule whose days are known", async () => {
    mount([PLACED]);
    const period = await openEdit(PLACED.id);
    expect(within(period).getByText(copy.schedule.periodHint)).toBeTruthy();
  });

  it("has no link without a host action", async () => {
    mount([UNKNOWN]);
    const period = await openEdit(UNKNOWN.id);
    expect(within(within(period).getByTestId("discount-days-unknown")).queryAllByRole("link")).toHaveLength(0);
  });

  it("links to the host's time-zone setting when it gives one", async () => {
    mount([UNKNOWN], { timeZoneSettings: { href: "/admin/loja/config#fuso" } });
    const period = await openEdit(UNKNOWN.id);
    const link = within(within(period).getByTestId("discount-days-unknown")).getByRole("link", {
      name: copy.window.openTimeZone,
    });
    expect(link.getAttribute("href")).toBe("/admin/loja/config#fuso");
  });

  it("calls the host's handler when its action is a click", async () => {
    const onClick = vi.fn();
    mount([UNKNOWN], { timeZoneSettings: { onClick } });
    const period = await openEdit(UNKNOWN.id);
    fireEvent.click(within(period).getByRole("button", { name: copy.window.openTimeZone }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("the list with a rule whose days are unknown (review round 4)", () => {
  it("says the short words in the cell, in both packs", () => {
    const formatters = createFormatters("pt-BR", "BRL");
    expect(formatWindow(UNKNOWN, formatters, copy)).toBe("Datas indisponíveis");
    expect(formatWindow(UNKNOWN, formatters, EN_US_DISCOUNTS_WEB_COPY)).toBe("Dates unavailable");
  });

  it("names the cause once, above the list, with the host's link", async () => {
    mount([UNKNOWN, { ...UNKNOWN, id: "d-3", name: "Outra" }, PLACED], { timeZoneSettings: { href: "/fuso" } });
    const notices = await screen.findAllByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toContain(copy.window.daysUnknownList);
    expect(within(notices[0]!).getByRole("link", { name: copy.window.openTimeZone }).getAttribute("href")).toBe("/fuso");
  });

  it("shows no notice when every row's days are known", async () => {
    mount([PLACED]);
    await screen.findAllByText(PLACED.name, undefined, SURFACE_LOADED);
    expect(screen.queryAllByTestId("discounts-days-unknown-notice")).toHaveLength(0);
  });

  it("marks the row under its name, for the phone where Vigência is off-screen", async () => {
    mount([UNKNOWN, PLACED]);
    const markers = await screen.findAllByTestId("discount-days-unknown-marker", undefined, SURFACE_LOADED);
    expect(markers.map((marker) => marker.textContent)).toEqual(
      Array.from({ length: markers.length }, () => copy.window.daysUnknown),
    );
    expect(markers.length).toBeGreaterThan(0);
  });
});
