// @vitest-environment jsdom
// The two surfaces `UsableModal` fetches on its first open, loaded up front so
// a cold worker's chunk import is not what the `findBy` waits on.
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import type { DiscountWireRecord } from "../api";
import type { DiscountsWebCopy } from "../copy";
import { createWebDiscounts } from "../create-web-discounts";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * FUT-4482, CP8: Novo desconto under an unknown store zone. The server says so
 * on the list envelope (`datesLocked`, an empty list included); the create
 * form then shows the zone notice, a locked and empty period with the
 * open-ended line under the boxes, and saves once with no dates. Under a known
 * zone the create form is as it was.
 */

const SURFACE_LOADED = { timeout: 10_000 };

const ROW: DiscountWireRecord = {
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
  startsOn: null,
  endsOn: null,
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

interface MountOptions {
  rows?: DiscountWireRecord[];
  /** The list envelope's own flag: the server's zone is unknown now. */
  zoneUnknown?: boolean;
  copy?: DiscountsWebCopy;
  locale?: string;
}

function mount(options: MountOptions = {}): Record<string, unknown>[] {
  const rows = options.rows ?? [];
  const sent: Record<string, unknown>[] = [];
  const transport: DiscountsTransport = {
    get: <T,>(url: string): Promise<T> =>
      url.endsWith("/targets")
        ? Promise.resolve({ data: STORY_GROUPS } as T)
        : Promise.resolve({
            data: rows,
            pagination: { page: 1, pageSize: 20, total: rows.length, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
            ...(options.zoneUnknown === true ? { datesLocked: true } : {}),
          } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      const written = body as Record<string, unknown>;
      sent.push(written);
      // As the server answers it: dates sent while its zone is unknown are
      // refused on the date field (`datesNeedKnownZone`).
      const dated = Boolean(written.startsAt) || Boolean(written.endsAt);
      if (options.zoneUnknown === true && dated) {
        return Promise.resolve({ ok: false, error: "Datas precisam do fuso", fieldErrors: { startsAt: "Datas precisam do fuso" } });
      }
      return Promise.resolve({ ok: true, data: { id: "d-9" } as T });
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
    wholeDays: true,
    timeZoneSettings: { href: "/configuracao/loja#fuso" },
  });
  render(
    <MemoryRouter initialEntries={["/discounts"]}>
      <Screen />
    </MemoryRouter>,
  );
  return sent;
}

async function openCreate(): Promise<HTMLElement> {
  const button = await screen.findByTestId("new-discount-button", undefined, SURFACE_LOADED);
  fireEvent.click(within(button).queryByRole("button") ?? button);
  return screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

const box = (period: HTMLElement, name: "startsAt" | "endsAt"): HTMLInputElement => {
  const field = within(period).getByTestId(`total-form-field-${name}`);
  return (field.querySelector("input") ?? field) as HTMLInputElement;
};

async function nameAndSave(sent: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  const name = screen.getByTestId("total-form-field-name");
  fireEvent.change(name.querySelector("input") ?? name, { target: { value: "Leve agora" } });
  const percent = screen.getByTestId("total-form-field-percentOff");
  fireEvent.change(percent.querySelector("input") ?? percent, { target: { value: "10" } });
  fireEvent.click(screen.getByTestId("discount-form-submit"));
  await waitFor(() => expect(sent).toHaveLength(1), SURFACE_LOADED);
  return sent[0]!;
}

describe("Novo desconto under an unknown store zone", () => {
  it("locks the period: the notice with its link, a disabled empty picker, the open-ended line", async () => {
    mount({ zoneUnknown: true });
    const period = await openCreate();
    const notice = within(period).getByTestId("discount-days-unknown");
    expect(notice.textContent).toContain(PT_BR_DISCOUNTS_WEB_COPY.window.datesLockedForm);
    expect(within(notice).getByTestId("discounts-open-time-zone").textContent).toBe(
      PT_BR_DISCOUNTS_WEB_COPY.window.openTimeZone,
    );
    expect(within(period).getByTestId("discount-period-picker").getAttribute("aria-disabled")).toBe("true");
    for (const name of ["startsAt", "endsAt"] as const) {
      expect(box(period, name).disabled).toBe(true);
      expect(box(period, name).value).toBe("");
    }
    expect(within(period).getByTestId("discount-period-unavailable").textContent).toBe(
      "Sem datas: a promoção vale a partir de agora, sem término.",
    );
  });

  it("saves once with no dates, open-ended, whatever day was tapped", async () => {
    const sent = mount({ zoneUnknown: true });
    const period = await openCreate();
    // A tap on the calendar places nothing while the zone is unknown.
    fireEvent.click(within(within(period).getByTestId("calendar-month-1")).getAllByTestId("calendar-date-10")[0]!);
    const body = await nameAndSave(sent);
    expect(body.startsAt ?? "").toBe("");
    expect(body.endsAt ?? "").toBe("");
    expect(body).not.toHaveProperty("keepWindow");
    await waitFor(() => expect(screen.queryAllByTestId("discount-form")).toHaveLength(0), SURFACE_LOADED);
    expect(sent).toHaveLength(1);
  });

  it("reads the lock off a locked row too", async () => {
    mount({ rows: [{ ...ROW, datesLocked: true }] });
    const period = await openCreate();
    expect(within(period).getByTestId("discount-period-picker").getAttribute("aria-disabled")).toBe("true");
  });

  it("says the open-ended line in English from an older host pack", async () => {
    const window = Object.fromEntries(
      Object.entries(EN_US_DISCOUNTS_WEB_COPY.window).filter(([key]) => !key.startsWith("datesLocked")),
    ) as DiscountsWebCopy["window"];
    mount({ zoneUnknown: true, copy: { ...EN_US_DISCOUNTS_WEB_COPY, window }, locale: "en-US" });
    const period = await openCreate();
    expect(within(period).getByTestId("discount-period-unavailable").textContent).toBe(
      EN_US_DISCOUNTS_WEB_COPY.window.datesLockedCreate,
    );
  });
});

describe("Novo desconto under a known store zone", () => {
  it("is unchanged: no notice, a live picker, empty enabled boxes", async () => {
    mount({ rows: [ROW] });
    const period = await openCreate();
    expect(within(period).queryAllByTestId("discount-days-unknown")).toHaveLength(0);
    expect(within(period).queryAllByTestId("discount-period-unavailable")).toHaveLength(0);
    expect(within(period).getByTestId("discount-period-picker").getAttribute("aria-disabled")).toBeNull();
    expect(box(period, "startsAt").disabled).toBe(false);
  });
});
