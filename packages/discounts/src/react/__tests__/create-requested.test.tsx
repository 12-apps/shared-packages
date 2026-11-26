// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState, type JSX } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import { createWebDiscounts } from "../create-web-discounts";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";

/**
 * FUT-4462: the host asks the screen for its create dialog. The dialog is the
 * header button's own; what is pinned here is WHEN it opens and that the
 * handler is told once.
 */

const PAGE = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0, hasNextPage: false, hasPreviousPage: false },
};

function transportOf(gate?: Promise<void>): DiscountsTransport {
  return {
    get: async <T,>(url: string): Promise<T> => {
      if (url.endsWith("/targets")) return { data: [] } as T;
      if (gate) await gate;
      return PAGE as T;
    },
    send: () => Promise.resolve({ ok: true, data: null as never }),
  };
}

function surface(transport: DiscountsTransport) {
  return createWebDiscounts({
    apiBase: "/api/admin/loja",
    copy: PT_BR_DISCOUNTS_WEB_COPY,
    locale: "pt-BR",
    currency: "BRL",
    currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
    onError: () => {},
    transport,
  });
}

const TITLE = PT_BR_DISCOUNTS_WEB_COPY.form.createTitle;

function Host({
  Screen,
  handled,
  initial = true,
}: {
  Screen: ReturnType<typeof surface>["Screen"];
  handled: () => void;
  initial?: boolean;
}): JSX.Element {
  const [requested, setRequested] = useState(initial);
  const [, setTick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTick((n) => n + 1)}>
        rerender
      </button>
      <button type="button" onClick={() => setRequested(false)}>
        drop
      </button>
      <Screen createRequested={requested} onCreateRequestHandled={handled} />
    </>
  );
}

function mount(Screen: ReturnType<typeof surface>["Screen"], handled: () => void, initial = true) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/discounts"]}>
        <Host Screen={Screen} handled={handled} initial={initial} />
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("the host's create request", () => {
  it("opens the Novo desconto dialog once and reports it once", async () => {
    const handled = vi.fn();
    mount(surface(transportOf()).Screen, handled);
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeTruthy();
    await waitFor(() => expect(handled).toHaveBeenCalledTimes(1));
  });

  it("does not reopen nor report again while the request stays true", async () => {
    const handled = vi.fn();
    mount(surface(transportOf()).Screen, handled);
    await screen.findByRole("dialog", { name: TITLE });
    // Close it as the operator would, then re-render with the request still true.
    fireEvent.keyDown(screen.getByRole("dialog", { name: TITLE }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull();
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("waits for the list, then opens once loaded", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled = vi.fn();
    mount(surface(transportOf(gate)).Screen, handled);
    expect(await screen.findByTestId("discounts-loading")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull();
    expect(handled).not.toHaveBeenCalled();
    release();
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeTruthy();
    await waitFor(() => expect(handled).toHaveBeenCalledTimes(1));
  });

  it("opens nothing without the request", async () => {
    const handled = vi.fn();
    mount(surface(transportOf()).Screen, handled, false);
    await screen.findByText(PT_BR_DISCOUNTS_WEB_COPY.screen.title);
    expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull();
    expect(handled).not.toHaveBeenCalled();
  });
});
