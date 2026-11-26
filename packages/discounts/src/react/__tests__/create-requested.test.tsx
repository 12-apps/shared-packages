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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const parts: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    parts.resolve = resolve;
  });
  return { promise, resolve: () => parts.resolve?.() };
}

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
      <button type="button" onClick={() => setRequested(true)}>
        ask
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
    fireEvent.keyDown(await screen.findByRole("dialog", { name: TITLE }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
    // Effects flush inside the click's act: a reopening would show by now.
    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("opens again for a new request once the host dropped the first", async () => {
    const handled = vi.fn();
    mount(surface(transportOf()).Screen, handled);
    fireEvent.keyDown(await screen.findByRole("dialog", { name: TITLE }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "drop" }));
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeTruthy();
    await waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
  });

  it("waits for the list, then opens once loaded", async () => {
    const gate = deferred();
    const handled = vi.fn();
    mount(surface(transportOf(gate.promise)).Screen, handled);
    expect(await screen.findByTestId("discounts-loading")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
    expect(handled).not.toHaveBeenCalled();
    gate.resolve();
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeTruthy();
    await waitFor(() => expect(handled).toHaveBeenCalledTimes(1));
  });

  it("opens nothing without the request props", async () => {
    const { Screen } = surface(transportOf());
    render(
      <MemoryRouter initialEntries={["/discounts"]}>
        <Screen />
      </MemoryRouter>,
    );
    expect(await screen.findByText(PT_BR_DISCOUNTS_WEB_COPY.screen.title)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull());
  });
});
