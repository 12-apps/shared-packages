// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import { createWebDiscounts, type DiscountsWebConfig } from "../create-web-discounts";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsTransport } from "../transport";

/**
 * The factory's contract: what it REFUSES to build, and what the screen it
 * builds does with a failure.
 *
 * The rendering itself is the stories' job — a book shows a grid better than an
 * assertion does. What belongs here is the half a story cannot show: that a
 * missing sentence fails at WIRING time rather than at first paint, and that a
 * failed read reaches `onError` as well as the operator.
 */

const transport: DiscountsTransport = {
  get: <T,>(url: string): Promise<T> =>
    url.endsWith("/targets")
      ? Promise.resolve({ data: [] } as T)
      : Promise.resolve({
          data: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            pageCount: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        } as T),
  send: () => Promise.resolve({ ok: true, data: null as never }),
};

function config(overrides: Partial<DiscountsWebConfig> = {}): DiscountsWebConfig {
  return {
    apiBase: "/api/admin/loja",
    copy: PT_BR_DISCOUNTS_WEB_COPY,
    locale: "pt-BR",
    currency: "BRL",
    currencyField: ({ name, label }) => <Fields.TextField name={name} label={label} />,
    onError: () => {},
    transport,
    ...overrides,
  };
}

describe("what it refuses to build", () => {
  it("W1: refuses a pack missing a sentence, naming the DOTTED path", () => {
    // Seventy-odd keys in seven groups: "copy is incomplete" would send a host
    // hunting. The path is the fix.
    const holed = {
      ...PT_BR_DISCOUNTS_WEB_COPY,
      actions: { ...PT_BR_DISCOUNTS_WEB_COPY.actions, deleteTitle: "" },
    };
    expect(() => createWebDiscounts(config({ copy: holed }))).toThrow(/actions\.deleteTitle/);
  });

  it("W2: refuses a pack missing a whole GROUP, not just a leaf", () => {
    const holed = { ...PT_BR_DISCOUNTS_WEB_COPY, card: undefined as never };
    expect(() => createWebDiscounts(config({ copy: holed }))).toThrow(/card\./);
  });

  it("W3: refuses a surface whose failures would reach nobody", () => {
    // The browser twin of `createApiDiscounts` refusing to build without a
    // logger, and for the same reason: a no-op default makes "nothing is
    // broken" and "nothing is watching" look identical.
    expect(() => createWebDiscounts(config({ onError: undefined as never }))).toThrow(
      /reach nobody/,
    );
  });

  it("W4: builds with a complete pack", () => {
    const surface = createWebDiscounts(config());
    expect(typeof surface.Screen).toBe("function");
    expect(typeof surface.api.list).toBe("function");
    expect(typeof surface.formatters.money).toBe("function");
  });
});

describe("the screen it builds", () => {
  function mount(overrides: Partial<DiscountsWebConfig> = {}) {
    const { Screen } = createWebDiscounts(config(overrides));
    render(
      <MemoryRouter initialEntries={["/discounts"]}>
        <Screen />
      </MemoryRouter>,
    );
  }

  it("W5: renders the host's own words, never a default", async () => {
    mount();
    expect(await screen.findByText(PT_BR_DISCOUNTS_WEB_COPY.screen.title)).toBeTruthy();
    expect(screen.getByText(PT_BR_DISCOUNTS_WEB_COPY.screen.create)).toBeTruthy();
  });

  it("W6: reports a failed page read to onError AND to the operator", async () => {
    const onError = vi.fn();
    mount({
      onError,
      transport: {
        get: <T,>(url: string): Promise<T> =>
          url.endsWith("/targets")
            ? Promise.resolve({ data: [] } as T)
            : Promise.reject(new Error("gateway down")),
        send: () => Promise.resolve({ ok: true, data: null as never }),
      },
    });
    // The operator's half.
    expect(await screen.findByText(PT_BR_DISCOUNTS_WEB_COPY.screen.loadFailed)).toBeTruthy();
    // And everybody else's.
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[1]).toBe("discounts.list");
  });

  it("W7: a failed CATALOG read is not a failed page", async () => {
    // The grid is perfectly readable without the collections; only the edit
    // form is withheld. Reporting it and carrying on is the whole behaviour.
    const onError = vi.fn();
    mount({
      onError,
      transport: {
        get: <T,>(url: string): Promise<T> =>
          url.endsWith("/targets")
            ? Promise.reject(new Error("catalog down"))
            : transport.get<T>(url),
        send: () => Promise.resolve({ ok: true, data: null as never }),
      },
    });
    expect(await screen.findByText(PT_BR_DISCOUNTS_WEB_COPY.screen.title)).toBeTruthy();
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[1]).toBe("discounts.targets");
    // In a `waitFor` rather than asserted once: the claim is that the error
    // state never appears, and a bare check would pass simply by running before
    // a render that was still coming.
    await waitFor(() =>
      expect(screen.queryByText(PT_BR_DISCOUNTS_WEB_COPY.screen.loadFailed)).toBeNull(),
    );
  });
});
