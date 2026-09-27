// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient, type DiscountWireRecord } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";

/**
 * The first-purchase switch (FUT-2825): offered where the condition means
 * something, read back from a stored rule, and sent with the write.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

/** The plain text field a host without a currency mask would pass. */
function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

/** A transport that RECORDS the write, so a case can assert the payload. */
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

function renderForm(editing: DiscountWireRecord | null) {
  const { transport, sent } = recordingTransport();
  const onSaved = vi.fn();
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={editing}
      onSaved={onSaved}
      onError={() => {}}
    />,
  );
  return { sent, onSaved };
}

/** One stored rule, as the wire hands it back. */
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
    comboRequirements: [
      { menuItemIds: [], categoryIds: ["c-sodas"], quantity: 2 },
      { menuItemIds: ["m-burger"], categoryIds: [], quantity: 1 },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function orderRecord(overrides: Partial<DiscountWireRecord> = {}): DiscountWireRecord {
  return comboRecord({
    id: "d-welcome",
    name: "Boas-vindas",
    scope: "ORDER",
    percentOffBp: 1_000,
    comboRequirements: [],
    ...overrides,
  });
}

function switchInput(): HTMLInputElement {
  const root = screen.getByTestId("discount-first-order-only");
  const input = root instanceof HTMLInputElement ? root : root.querySelector("input");
  if (!input) throw new Error("the first-purchase switch has no input");
  return input as HTMLInputElement;
}

describe("the first-purchase switch", () => {
  it("reads back a rule saved with it on, and sends it with the write", async () => {
    const { sent } = renderForm(orderRecord({ firstOrderOnly: true }));
    expect(switchInput().checked).toBe(true);

    fireEvent.click(screen.getByTestId("discount-form-submit"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ firstOrderOnly: true, scope: "ORDER" });
  });

  it("starts off for a rule that predates it", () => {
    renderForm(orderRecord());
    expect(switchInput().checked).toBe(false);
  });

  it("is not offered on a combo, which keeps its own rules", async () => {
    renderForm(comboRecord());
    await screen.findByTestId("discount-form");
    expect(screen.queryAllByTestId("discount-first-order-only")).toHaveLength(0);
  });
});
