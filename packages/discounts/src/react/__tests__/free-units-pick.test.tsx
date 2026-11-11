// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDiscountsApiClient } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";
import { STORY_GROUPS } from "../__stories__/fixtures";
import { findReach, peek, reach, reachLabel, submitForm } from "./step-form-shim";

/**
 * FUT-4441 / FUT-4470: the form-level half of "picking a product clears the
 * refusal". K28 in kind-authoring checks the builder's own rule; this file walks
 * the wiring a pick travels through — picker → combo requirements → the form's
 * errors — with the picker replaced by a button that picks, because the real
 * one's MUI list is what made K28 too slow for a loaded runner. `vi.mock` is
 * file-wide, which is why this lives in its own file.
 */
vi.mock("../target-picker-field", () => ({
  TargetPickerField: ({
    onChange,
    dataTestId,
  }: {
    onChange: (next: string[]) => void;
    dataTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={`${dataTestId ?? "picker"}-pick`}
      onClick={() => onChange(["m-burger"])}
    >
      pick
    </button>
  ),
}));

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");

function PlainCurrency({ name, label }: { name: string; label: string }) {
  return <input name={name} aria-label={label} readOnly />;
}

const transport: DiscountsTransport = {
  get: <T,>(url: string): Promise<T> =>
    url.includes("/discounts/targets")
      ? Promise.resolve({ data: STORY_GROUPS } as T)
      : Promise.resolve({ data: [], pagination: {} } as T),
  send: <T,>(): Promise<DiscountsResult<T>> =>
    Promise.resolve({ ok: true, data: null as T }),
};

function renderForm(): void {
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/loja", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={PlainCurrency}
      groups={STORY_GROUPS}
      editing={null}
      onSaved={() => {}}
      onError={() => {}}
    />,
  );
}

describe("FUT-4441: a pick through the form clears the product refusal", () => {
  it("drops the product line once a product is picked, and no toast is ever raised", async () => {
    renderForm();
    fireEvent.click(screen.getAllByText("Itens grátis")[0] as HTMLElement);
    await findReach("free-units-builder");
    // Everything else valid, so the product list is the ONE refusal and the
    // toast stands or falls with it.
    fireEvent.change(reachLabel(copy.form.name), {
      target: { value: "Leve 3 pague 2" },
    });
    fireEvent.change(reach("free-units-quantity"), {
      target: { value: "3" },
    });
    fireEvent.change(reach("free-units-free"), {
      target: { value: "1" },
    });

    submitForm();
    await waitFor(() => expect(peek("free-units-message")).toBeTruthy());
    // The toast is the SERVER's refusal now (FUT-4477, `FormErrorSnackbar show`):
    // a step's own errors are said on the step, and the toast stays down.
    await waitFor(() => expect(screen.queryByTestId("total-form-error-snackbar")).toBeNull());

    fireEvent.click(reach("free-units-items-pick"));

    await waitFor(() => {
      expect(screen.queryByTestId("free-units-message")).toBeNull();
      expect(screen.queryByTestId("total-form-error-snackbar")).toBeNull();
    });
  });

  it("keeps a quantity refusal after the pick, and no toast is ever raised", async () => {
    renderForm();
    fireEvent.click(screen.getAllByText("Itens grátis")[0] as HTMLElement);
    await findReach("free-units-builder");
    fireEvent.change(reachLabel(copy.form.name), {
      target: { value: "Leve 3 pague 2" },
    });
    fireEvent.change(reach("free-units-quantity"), {
      target: { value: "0" },
    });

    submitForm();
    await waitFor(() => expect(peek("free-units-message")).toBeTruthy());

    fireEvent.click(reach("free-units-items-pick"));

    await waitFor(() => {
      expect(screen.queryByTestId("free-units-message")).toBeNull();
    });
    expect(
      screen.getAllByText(copy.form.invalidComboQuantity).length,
    ).toBeGreaterThan(0);
    // No toast for a client refusal since FUT-4477 (the server's alone).
    await waitFor(() => expect(screen.queryByTestId("total-form-error-snackbar")).toBeNull());
  });
});
