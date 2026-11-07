// @vitest-environment jsdom
// The two surfaces `UsableModal` fetches on its first open, loaded up front so
// a cold worker's chunk import is not what the `findBy` waits on.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";
import { createTheme, ThemeProvider } from "@12-apps/ui/mui/styles";

import type { DiscountWireRecord } from "../api";
import type { DiscountsWebCopy } from "../copy";
import { createWebDiscounts } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { createFormatters, formatWindow } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { STILL_THEME } from "./still-theme";

/**
 * FUT-4482, review round 9. Under an unknown zone the dates are locked and
 * everything else saves: an older host pack still says the locked words (B2),
 * the locked boxes are read and never block a save (N3), the list says the
 * dates are locked (UI), and a form opened before the zone turned unknown
 * saves an unchanged period without re-sending it (N4).
 */

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

/** The same legacy row read under a KNOWN zone: its days, nothing locked. */
const OPEN: DiscountWireRecord = { ...LOCKED, datesLocked: undefined };

/** A host's pack from before round 8: no `datesLocked*` keys (nor round 9's list one). */
function olderPack(pack: DiscountsWebCopy): DiscountsWebCopy {
  const window = Object.fromEntries(
    Object.entries(pack.window).filter(([key]) => !key.startsWith("datesLocked")),
  ) as DiscountsWebCopy["window"];
  return { ...pack, window };
}

interface MountOptions {
  copy?: DiscountsWebCopy;
  locale?: string;
  wholeDays?: boolean;
}

function mount(rows: DiscountWireRecord[], options: MountOptions = {}): Record<string, unknown>[] {
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
    copy: options.copy ?? PT_BR_DISCOUNTS_WEB_COPY,
    locale: options.locale ?? "pt-BR",
    currency: "BRL",
    currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
    onError: () => {},
    transport,
    ...(options.wholeDays === false ? {} : { wholeDays: true }),
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

// The worker's first mount of the admin and its edit form pays for emotion
// writing every style once (1–1.5 s alone, several times that on a loaded
// runner). Paid here, under the hook's own limit, not inside the first case
// (FUT-4530).
beforeAll(async () => {
  mount([LOCKED]);
  await openEdit(LOCKED.id);
  cleanup();
});

const box = (period: HTMLElement, name: "startsAt" | "endsAt"): HTMLInputElement => {
  const field = within(period).getByTestId(`total-form-field-${name}`);
  return (field.querySelector("input") ?? field) as HTMLInputElement;
};

async function pauseAndSave(sent: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  const active = screen.getByTestId("discount-active");
  fireEvent.click(active.querySelector("input") ?? active);
  fireEvent.click(screen.getByTestId("discount-form-submit"));
  await waitFor(() => expect(sent).toHaveLength(1), SURFACE_LOADED);
  return sent[0]!;
}

describe("an older host pack on a locked row (B2)", () => {
  it.each([
    ["pt-BR", PT_BR_DISCOUNTS_WEB_COPY],
    ["en-US", EN_US_DISCOUNTS_WEB_COPY],
  ] as const)("fills the locked notice and caption in the host's language (%s)", async (locale, pack) => {
    mount([LOCKED], { copy: olderPack(pack), locale });
    const period = await openEdit(LOCKED.id);
    const notice = within(period).getByTestId("discount-days-unknown").textContent ?? "";
    const caption = within(period).getByTestId("discount-period-unavailable").textContent ?? "";
    expect(notice).toContain(pack.window.datesLockedForm);
    expect(caption).toBe(pack.window.datesLockedBoxes);
    expect(caption.trim()).not.toBe("");
  });

  it("fills the list's locked notice in the host's language too", async () => {
    mount([LOCKED], { copy: olderPack(EN_US_DISCOUNTS_WEB_COPY), locale: "en-US" });
    const notice = await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED);
    expect(notice.textContent).toContain(EN_US_DISCOUNTS_WEB_COPY.window.datesLockedList);
  });
});

describe("the locked boxes that hold days (UI, round 9)", () => {
  it("are read-only, not disabled: the value in the input's ink, described by the line under them", async () => {
    mount([LOCKED]);
    const period = await openEdit(LOCKED.id);
    for (const name of ["startsAt", "endsAt"] as const) {
      const input = box(period, name);
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
      expect(input.getAttribute("aria-describedby")).toBe("discount-period-unavailable");
      expect(getComputedStyle(input).color).toBe(colorOf(createTheme().palette.text.primary));
    }
    fireEvent.change(box(period, "startsAt"), { target: { value: "01/12/2026" } });
    expect(box(period, "startsAt").value).toBe("10/11/2026");
  });
});

/** A CSS colour as the browser normalises it. */
function colorOf(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  return probe.style.color;
}

describe("locked boxes never block a save (N3)", () => {
  // Equal legacy days, on a host that did not say `wholeDays`: the client's own
  // order check would refuse them, in a box the operator cannot change.
  const SAME_DAY: DiscountWireRecord = { ...LOCKED, endsAt: "2026-11-10T12:00:00.000Z", endsOn: "2026-11-10" };

  it("saves a pause of a locked row whose shown days the client would refuse", async () => {
    const sent = mount([SAME_DAY], { wholeDays: false });
    await openEdit(SAME_DAY.id);
    const body = await pauseAndSave(sent);
    expect(body).toMatchObject({ active: false, keepWindow: true });
    expect(screen.queryAllByTestId("total-form-field-endsAt-message")).toHaveLength(0);
  });
});

describe("an unchanged period on an open form keeps the stored window (N4)", () => {
  it("sends keepWindow, no dates, when the days are the ones the form opened with", async () => {
    const sent = mount([OPEN]);
    await openEdit(OPEN.id);
    const body = await pauseAndSave(sent);
    expect(body).toMatchObject({ active: false, keepWindow: true });
    expect(body).not.toHaveProperty("startsAt");
    expect(body).not.toHaveProperty("endsAt");
  });

  it("still sends changed days as days", async () => {
    const sent = mount([OPEN]);
    const period = await openEdit(OPEN.id);
    fireEvent.change(box(period, "endsAt"), { target: { value: "25/11/2026" } });
    const body = await pauseAndSave(sent);
    expect(body).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-25" });
    expect(body).not.toHaveProperty("keepWindow");
  });

  it("keeps the old body on a host that counts no whole days", async () => {
    const sent = mount([OPEN], { wholeDays: false });
    await openEdit(OPEN.id);
    const body = await pauseAndSave(sent);
    expect(body).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-20" });
    expect(body).not.toHaveProperty("keepWindow");
  });
});

describe("the list notice under an unknown zone (UI, round 9)", () => {
  it("is said for locked rows that still show their days", async () => {
    mount([LOCKED]);
    const notice = await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED);
    expect(notice.textContent).toContain(PT_BR_DISCOUNTS_WEB_COPY.window.datesLockedList);
  });

  it("says the days-unknown words, which cover the lock, when any row has no days", async () => {
    mount([LOCKED, { ...LOCKED, id: "d-2", startsOn: undefined, endsOn: undefined, daysUnknown: true }]);
    const notice = await screen.findByTestId("discounts-days-unknown-notice", undefined, SURFACE_LOADED);
    expect(notice.textContent).toContain(PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknownList);
    expect(PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknownList).toContain("bloqueadas");
    expect(screen.getAllByTestId("discounts-days-unknown-notice")).toHaveLength(1);
  });

  it("is not said with nothing locked", async () => {
    mount([OPEN]);
    await screen.findAllByTestId(`discount-actions-${OPEN.id}`, undefined, SURFACE_LOADED);
    expect(screen.queryAllByTestId("discounts-days-unknown-notice")).toHaveLength(0);
  });
});

describe("formatWindow's language for an older pack (B3)", () => {
  // The documented order (`completeWebCopy`): the locale it is given — here
  // the formatters' — then the pack's own calendar language, then its words.
  const older: DiscountsWebCopy = {
    ...PT_BR_DISCOUNTS_WEB_COPY,
    window: Object.fromEntries(
      Object.entries(PT_BR_DISCOUNTS_WEB_COPY.window).filter(([key]) => key !== "daysUnknown"),
    ) as DiscountsWebCopy["window"],
  };
  const row = { startsAt: null, endsAt: null, daysUnknown: true };

  it("takes the formatters' locale over the pack's words: en-US formatters say it in English", () => {
    expect(formatWindow(row, createFormatters("en-US", "BRL"), older)).toBe(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknown);
  });

  it("says it in Portuguese with pt-BR formatters", () => {
    expect(formatWindow(row, createFormatters("pt-BR", "BRL"), older)).toBe(PT_BR_DISCOUNTS_WEB_COPY.window.daysUnknown);
  });
});
