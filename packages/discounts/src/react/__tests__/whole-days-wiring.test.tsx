// @vitest-environment jsdom
// The two surfaces `UsableModal` fetches on its first open, loaded up front so
// a cold worker's chunk import is not what the `findBy` waits on (see
// discount-dialog.test.tsx).
import "@12-apps/ui/feedback/StackedModal";
import "@12-apps/ui/data-display/Sheet";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import type { DiscountWireRecord } from "../api";
import { createWebDiscounts, type DiscountsWebConfig } from "../create-web-discounts";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * `wholeDays` from the factory to the form (FUT-4482, review round 2): the
 * host's flag reaches the create dialog, the edit dialog and the bare
 * `DiscountForm`, so equal days are a one-day promotion in each. Without the
 * wiring every form falls back to refusing them, which is what each case
 * would then see.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const SURFACE_LOADED = { timeout: 10_000 };

const RECORD: DiscountWireRecord = {
  id: "d-1",
  name: "Semana do hambúrguer",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  amountOffCents: null,
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: null,
  startsAt: "2026-11-10T03:00:00.000Z",
  endsAt: null,
  startsOn: "2026-11-10",
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

function surface(wholeDays: boolean, rows: DiscountWireRecord[] = []) {
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
      return Promise.resolve({ ok: true, data: { ...RECORD, id: "d-2" } as T });
    },
  };
  const config: DiscountsWebConfig = {
    apiBase: "/api/admin/loja",
    copy,
    locale: "pt-BR",
    currency: "BRL",
    currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
    onError: () => {},
    transport,
    ...(wholeDays ? { wholeDays } : {}),
  };
  return { built: createWebDiscounts(config), sent };
}

function mountScreen(wholeDays: boolean, rows: DiscountWireRecord[] = []) {
  const { built, sent } = surface(wholeDays, rows);
  const { Screen } = built;
  render(
    <MemoryRouter initialEntries={["/discounts"]}>
      <Screen />
    </MemoryRouter>,
  );
  return sent;
}

const box = (name: "startsAt" | "endsAt"): HTMLInputElement =>
  screen.getByTestId(`total-form-field-${name}`) as HTMLInputElement;
const typeInto = (name: "startsAt" | "endsAt", value: string): void => {
  fireEvent.change(box(name), { target: { value } });
};
const tap = (day: number): void => {
  const cell = within(screen.getByTestId("discount-period"))
    .getAllByRole("gridcell", { name: `${day} de novembro de 2026` })[0]!;
  fireEvent.click(cell);
};
const fillRequired = (): void => {
  fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: "Dia do hambúrguer" } });
  fireEvent.change(screen.getByLabelText(copy.form.percentOff), { target: { value: "10" } });
};

async function openCreate(): Promise<void> {
  fireEvent.click((await screen.findAllByText(copy.screen.create))[0]!);
  await screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

async function openEdit(): Promise<void> {
  const kebab = await screen.findAllByTestId(`discount-actions-${RECORD.id}`, undefined, SURFACE_LOADED);
  fireEvent.click(within(kebab[0]!).queryByRole("button") ?? kebab[0]!);
  fireEvent.click(await screen.findByTestId("discount-action-edit"));
  await screen.findByTestId("discount-period", undefined, SURFACE_LOADED);
}

describe("createWebDiscounts({ wholeDays: true }).Screen — the create dialog", () => {
  it("WD1: accepts equal typed days and sends them", async () => {
    const sent = mountScreen(true);
    await openCreate();
    fillRequired();
    typeInto("startsAt", "10112026");
    typeInto("endsAt", "10112026");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-10" });
  });

  it("WD2: a second tap on Início makes a one-day range", async () => {
    mountScreen(true);
    await openCreate();
    typeInto("startsAt", "10112026");
    tap(10);
    await waitFor(() => expect(box("endsAt").value).toBe("10/11/2026"));
    expect(box("startsAt").value).toBe("10/11/2026");
  });
});

describe("createWebDiscounts({ wholeDays: true }).Screen — the edit dialog", () => {
  it("WD3: a second tap on the record's Início makes a one-day range", async () => {
    mountScreen(true, [RECORD]);
    await openEdit();
    expect(box("startsAt").value).toBe("10/11/2026");
    tap(10);
    await waitFor(() => expect(box("endsAt").value).toBe("10/11/2026"));
  });

  it("WD4: accepts equal typed days and sends them", async () => {
    const sent = mountScreen(true, [RECORD]);
    await openEdit();
    typeInto("endsAt", "10112026");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-10" });
  });
});

describe("createWebDiscounts({ wholeDays: true }).DiscountForm", () => {
  it("WD5: accepts equal days, typed and by a second tap", async () => {
    const { built, sent } = surface(true);
    const { DiscountForm } = built;
    render(<DiscountForm groups={STORY_GROUPS} editing={null} onSaved={() => {}} />);
    fillRequired();
    typeInto("startsAt", "10112026");
    tap(10);
    await waitFor(() => expect(box("endsAt").value).toBe("10/11/2026"));
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ startsAt: "2026-11-10", endsAt: "2026-11-10" });
  });
});
