// @vitest-environment jsdom
// The surface's chunks, warmed before the test starts.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";
import { ThemeProvider } from "@12-apps/ui/mui/styles";

import type { DiscountWireRecord } from "../api";
import { missingWebCopy, type DiscountsWebCopy } from "../copy";
import { createWebDiscounts } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { browserRootFontForThisFile, STILL_THEME } from "./still-theme";

/**
 * FUT-4482, review round 6 (release): the web-copy keys this branch added are
 * OPTIONAL. A host whose own pack was written before them — every key it
 * always had, none of the new ones — still mounts, and every new sentence is
 * said from the package's pack for the host's locale. No major release.
 */

const SURFACE_LOADED = { timeout: 10_000 };

/** A host's pack from before this branch: the new keys left out. */
function olderPack(pack: DiscountsWebCopy): DiscountsWebCopy {
  const without = <T extends object>(group: T, keys: readonly string[]): T =>
    Object.fromEntries(Object.entries(group).filter(([key]) => !keys.includes(key))) as T;
  return {
    ...pack,
    window: without(pack.window, [
      "daysUnknown",
      "daysUnknownList",
      "daysUnknownForm",
      "daysUnknownBoxes",
      "daysUnknownPaused",
      "openTimeZone",
    ]),
    form: without(pack.form, ["calendar", "endsBeforeStartDay"]),
  };
}

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
  active: false,
  categoryIds: [],
  menuItemIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
};

const transport: DiscountsTransport = {
  get: <T,>(url: string): Promise<T> =>
    url.endsWith("/targets")
      ? Promise.resolve({ data: STORY_GROUPS } as T)
      : Promise.resolve({
          data: [UNKNOWN],
          pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
        } as T),
  send: <T,>() => Promise.resolve({ ok: true as const, data: { id: "d-1" } as T }),
};

function mount(copy: DiscountsWebCopy, locale: string) {
  const { Screen } = createWebDiscounts({
    apiBase: "/api/admin/loja",
    copy,
    locale,
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
}

async function openEdit(): Promise<HTMLElement> {
  const kebab = await screen.findAllByTestId(`discount-actions-${UNKNOWN.id}`, undefined, SURFACE_LOADED);
  fireEvent.click(within(kebab[0]!).queryByRole("button") ?? kebab[0]!);
  fireEvent.click(await screen.findByTestId("discount-action-edit"));
  return screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

// The worker's first mount of the admin and its form pays for emotion writing
// every style once (1–1.5 s alone, several times that on a loaded runner).
// Paid here, under the hook's own limit, not inside the first case (FUT-4623).
browserRootFontForThisFile();

beforeAll(async () => {
  mount(olderPack(PT_BR_DISCOUNTS_WEB_COPY), "pt-BR");
  await openEdit();
  cleanup();
});

describe.each([
  ["pt-BR", PT_BR_DISCOUNTS_WEB_COPY],
  ["en-US", EN_US_DISCOUNTS_WEB_COPY],
])("a %s host pack without the new keys", (locale, pack) => {
  const older = olderPack(pack);

  it("is complete to missingWebCopy and mounts", () => {
    expect(missingWebCopy(older, PT_BR_DISCOUNTS_WEB_COPY)).toEqual([]);
    expect(() =>
      createWebDiscounts({
        apiBase: "/x",
        copy: older,
        locale,
        currency: "BRL",
        currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
        onError: () => {},
        transport,
      }),
    ).not.toThrow();
  });

  it("says the list's sentences from the package's pack for its locale", async () => {
    mount(older, locale);
    expect((await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED)).textContent).toContain(
      pack.window.daysUnknownList,
    );
    // The rule is paused, and the phone's marker says so (round 6).
    expect(screen.getAllByTestId("discount-days-unknown-marker")[0]!.textContent).toBe(pack.window.daysUnknownPaused);
  });

  it("says the form's sentences and names the calendar from that pack", async () => {
    mount(older, locale);
    const period = await openEdit();
    expect(screen.getByTestId("discount-days-unknown").textContent).toContain(pack.window.daysUnknownForm);
    expect(within(period).getByTestId("discount-period-unavailable").textContent).toBe(pack.window.daysUnknownBoxes);
    expect(within(period).getAllByRole("button", { name: pack.form.calendar.nextMonth }).length).toBeGreaterThan(0);
  });
});
