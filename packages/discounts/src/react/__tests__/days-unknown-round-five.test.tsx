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
import { createWebDiscounts, type DiscountsWebConfig } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { STILL_THEME } from "./still-theme";
import { getByLabelFor } from "./labelled-control";

/**
 * FUT-4482, review round 5 (B2): a promotion edit is never refused. While the
 * server cannot place a rule's days, the calendar and both boxes are disabled
 * and say so, every other field stays editable, and Salvar saves everything
 * but the dates — `keepWindow: true`, no dates sent — and closes like any save.
 * The most the screen does is one amber notice above the editor.
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

const PLACED: DiscountWireRecord = { ...UNKNOWN, id: "d-2", daysUnknown: undefined, startsOn: "2026-11-10", endsOn: "2026-11-20" };

function mount(rows: DiscountWireRecord[], extra: Partial<DiscountsWebConfig> = {}) {
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
  fireEvent.click(await screen.findByTestId("discount-action-edit"));
  return screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

// The worker's first mount of the admin and its edit form pays for emotion
// writing every style once (1–1.5 s alone, several times that on a loaded
// runner). Paid here, under the hook's own limit, not inside the first case
// (FUT-4530).
beforeAll(async () => {
  mount([UNKNOWN]);
  await openEdit(UNKNOWN.id);
  cleanup();
});

const dateBoxes = (period: HTMLElement): HTMLInputElement[] =>
  (["startsAt", "endsAt"] as const).map((name) => within(period).getByTestId(`total-form-field-${name}`).querySelector("input") ?? within(period).getByTestId(`total-form-field-${name}`)) as HTMLInputElement[];

function toggleActiveOff(): void {
  const active = screen.getByTestId("discount-active");
  fireEvent.click(active.querySelector("input") ?? active);
}

async function saveAndClose(): Promise<void> {
  fireEvent.click(screen.getByTestId("discount-form-submit"));
  await waitFor(() => expect(screen.queryAllByTestId("discount-form")).toHaveLength(0), SURFACE_LOADED);
}

describe("the period while the days are unknown (review round 5)", () => {
  // Review round 6: edited on purpose. The words in each box were cut at 320
  // and drawn in placeholder grey; one line under both says them now, and is
  // each box's accessible description.
  it("disables the calendar and both boxes, and the line under them describes both", async () => {
    mount([UNKNOWN]);
    const period = await openEdit(UNKNOWN.id);
    // `hidden: true` skips the per-cell visibility check (a getComputedStyle
    // over ~900 emotion sheets, 200 ms for the 84 days): the period sits in the
    // open dialog, so no cell of it is hidden either way (FUT-4530).
    const days = within(period).getAllByRole("gridcell", { hidden: true }).filter((cell) => cell.getAttribute("data-in-month") === "true");
    expect(days.every((cell) => cell.getAttribute("aria-disabled") === "true")).toBe(true);
    const line = within(period).getByTestId("discount-period-unavailable");
    expect(line.textContent).toBe(copy.window.daysUnknownBoxes);
    for (const box of dateBoxes(period)) {
      expect(box.disabled).toBe(true);
      expect(box.placeholder).toBe("");
      expect(box.getAttribute("aria-describedby")).toBe(line.id);
    }
    expect(within(period).getByRole("group", { name: copy.schedule.periodTitle, hidden: true }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(days[9]!);
    expect(dateBoxes(period).map((box) => box.value)).toEqual(["", ""]);
  });

  // Review round 7: the line under the boxes pointed at nothing new — it said
  // the amber notice again. It is short now and points at it, and the boxes
  // are drawn disabled (MUI's disabled fill and edge), not as empty fields.
  it("says a short pointer under the boxes, never the notice again", async () => {
    mount([UNKNOWN]);
    const period = await openEdit(UNKNOWN.id);
    const line = within(period).getByTestId("discount-period-unavailable").textContent ?? "";
    const notice = within(period).getByTestId("discount-days-unknown").textContent ?? "";
    expect(line).toBe("Sem datas: veja o aviso acima.");
    expect(EN_US_DISCOUNTS_WEB_COPY.window.daysUnknownBoxes).toBe("No dates: see the notice above.");
    expect(notice).not.toContain(line);
    expect(line).not.toMatch(/fuso/iu);
  });

  it("draws the disabled boxes with the theme's disabled fill and edge", async () => {
    mount([UNKNOWN]);
    const period = await openEdit(UNKNOWN.id);
    const { action } = createTheme().palette;
    const rules = [...document.querySelectorAll("style")].map((tag) => tag.textContent ?? "").join("\n");
    for (const name of ["startsAt", "endsAt"]) {
      const wrapper = within(period).getByTestId(`total-form-field-${name}-box`);
      const own = wrapper.className
        .split(" ")
        .filter((cls) => cls.startsWith("css-"))
        .map((cls) => rules.split(`.${cls} `).slice(1).map((rule) => rule.split("}")[0]).join(""))
        .join("");
      expect(own).toContain(`background-color:${action.disabledBackground}`);
      expect(own).toContain(`border-color:${action.disabled}`);
    }
  });

  it("keeps both boxes and the calendar live on a rule whose days are known", async () => {
    mount([PLACED]);
    const period = await openEdit(PLACED.id);
    expect(dateBoxes(period).every((box) => !box.disabled)).toBe(true);
    expect(within(period).getAllByRole("gridcell", { hidden: true }).some((cell) => cell.getAttribute("aria-disabled") !== "true")).toBe(true);
  });

  it("keeps every other field editable", async () => {
    mount([UNKNOWN]);
    await openEdit(UNKNOWN.id);
    const name = getByLabelFor(copy.form.name);
    expect(name.disabled).toBe(false);
    expect(getByLabelFor(copy.form.percentOff).disabled).toBe(false);
  });

  it("says it once, amber, with the round-five words and link", async () => {
    mount([UNKNOWN], { timeZoneSettings: { href: "/fuso" } });
    const period = await openEdit(UNKNOWN.id);
    const notice = within(period).getByTestId("discount-days-unknown");
    expect(notice.textContent).toContain("As datas salvas não mudam ao salvar.");
    expect(within(notice).getByRole("link", { name: "Ver fuso horário da loja" }).getAttribute("href")).toBe("/fuso");
    expect(EN_US_DISCOUNTS_WEB_COPY.window.openTimeZone).toBe("View the store's time zone");
  });
});

describe("Salvar while the days are unknown (review round 5)", () => {
  it("pauses: sends keepWindow and no dates, closes, and shows no refusal", async () => {
    const sent = mount([UNKNOWN]);
    await openEdit(UNKNOWN.id);
    toggleActiveOff();
    await saveAndClose();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ active: false, keepWindow: true });
    expect(sent[0]).not.toHaveProperty("startsAt");
    expect(sent[0]).not.toHaveProperty("endsAt");
    expect(screen.queryAllByTestId("discount-form-error")).toHaveLength(0);
  });

  // One edit per test: both edits in one test re-render the whole form twice
  // and ran past vitest's 5 s on a loaded CI shard (main, CI #42302355616).
  it("renames the same way", async () => {
    const sent = mount([UNKNOWN]);
    await openEdit(UNKNOWN.id);
    fireEvent.change(getByLabelFor(copy.form.name), { target: { value: "Semana nova" } });
    await saveAndClose();
    expect(sent[0]).toMatchObject({ name: "Semana nova", keepWindow: true });
    expect(sent[0]).not.toHaveProperty("startsAt");
  });

  it("changes the value the same way", async () => {
    const sent = mount([UNKNOWN]);
    await openEdit(UNKNOWN.id);
    fireEvent.change(getByLabelFor(copy.form.percentOff), { target: { value: "15" } });
    await saveAndClose();
    expect(sent[0]).toMatchObject({ percentOffBp: 1_500, keepWindow: true });
    expect(sent[0]).not.toHaveProperty("startsAt");
  });

  // Round 9 (N4): days left as they opened are kept (`keepWindow`, see
  // dates-locked-round-nine), so the dates are sent once the operator CHANGES them.
  it("sends changed dates, and no marker, for a rule whose days are known", async () => {
    const sent = mount([PLACED]);
    const period = await openEdit(PLACED.id);
    const endsAt = within(period).getByTestId("total-form-field-endsAt");
    fireEvent.change(endsAt.querySelector("input") ?? endsAt, { target: { value: "25/11/2026" } });
    await saveAndClose();
    expect(sent[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-25" });
    expect(sent[0]).not.toHaveProperty("keepWindow");
  });
});
