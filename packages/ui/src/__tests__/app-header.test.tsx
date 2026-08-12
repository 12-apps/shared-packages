import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AppHeader,
  AppHeaderBrand,
  AppHeaderDetails,
  AppHeaderIdentity,
  AppHeaderStatus,
  highlightOf,
  initialsOf,
} from "../components/navigation/AppHeader";

/**
 * What the header PROMISES a consuming app, as opposed to how it looks.
 *
 * The bar is meant to serve a storefront, a back office and a platform console
 * from one implementation, so the claims worth pinning are the ones an app
 * would silently lose: that a slot is rendered where the caller put it, that the
 * disclosure is a real button an assistive tech can find and open, that a logo
 * which fails to load degrades to initials rather than to a broken-image glyph,
 * and that the details panel takes the surface the viewport calls for.
 */

/** jsdom answers every media query `false`; this lets a test say otherwise. */
function matchMediaReturning(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

const STORE_ROWS = [
  { id: "now", label: "Agora", value: "Aberto até 22h", tone: "success" as const },
  { id: "pickup", label: "Retirada", value: "No balcão, na hora" },
];

describe("AppHeader shell", () => {
  it("renders every slot the caller filled", () => {
    render(
      <AppHeader
        position="static"
        leading={<button type="button">Voltar</button>}
        meta="Build 18"
        actions={<button type="button">Entrar</button>}
        below={<input aria-label="Buscar" />}
      >
        <AppHeaderIdentity title="Future Drink" />
      </AppHeader>,
    );

    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(screen.getByTestId("app-header-meta")).toHaveTextContent("Build 18");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar")).toBeInTheDocument();
    expect(screen.getByTestId("app-header-identity-title")).toHaveTextContent("Future Drink");
  });

  it("omits the trailing column entirely when nothing trails", async () => {
    // Not cosmetic: an empty flex column still takes its gap, which on a phone
    // is the difference between a name that fits and one that ellipsises.
    render(
      <AppHeader position="static">
        <AppHeaderIdentity title="Future Drink" />
      </AppHeader>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("app-header-actions")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-header-meta")).not.toBeInTheDocument();
    });
  });

  it("reserves the bar's space when it is fixed, and only then", async () => {
    // A fixed bar is out of flow; without the spacer the page's first element
    // renders underneath it.
    const { rerender } = render(
      <AppHeader position="fixed">
        <AppHeaderIdentity title="Future Drink" />
      </AppHeader>,
    );
    expect(screen.getByTestId("app-header-spacer")).toBeInTheDocument();

    rerender(
      <AppHeader position="sticky">
        <AppHeaderIdentity title="Future Drink" />
      </AppHeader>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("app-header-spacer")).not.toBeInTheDocument(),
    );
  });

  it("lets a caller opt out of the spacer it would otherwise render", async () => {
    render(
      <AppHeader position="fixed" disableSpacer>
        <AppHeaderIdentity title="Future Drink" />
      </AppHeader>,
    );

    await waitFor(() =>
      expect(screen.queryByTestId("app-header-spacer")).not.toBeInTheDocument(),
    );
  });
});

describe("AppHeaderBrand", () => {
  it("labels the mark with the name rather than spelling out the initials", () => {
    render(<AppHeaderBrand name="Future Drink" />);

    const mark = screen.getByRole("img", { name: "Future Drink" });
    expect(within(mark).getByTestId("app-header-brand-initials")).toHaveTextContent("FD");
  });

  it("takes the first and last initial, and copes with one word or none", () => {
    expect(initialsOf("Future Drink")).toBe("FD");
    expect(initialsOf("Mercado de Autoatendimento Venda Nova")).toBe("MN");
    expect(initialsOf("Verde")).toBe("V");
    expect(initialsOf("   ")).toBe("·");
  });

  it("shows the logo when there is one", async () => {
    render(<AppHeaderBrand name="Future Drink" logoUrl="/logo.png" />);

    expect(screen.getByTestId("app-header-brand-logo")).toHaveAttribute("src", "/logo.png");
    await waitFor(() =>
      expect(screen.queryByTestId("app-header-brand-initials")).not.toBeInTheDocument(),
    );
  });

  it("falls back to the initials when the logo cannot load", async () => {
    // The alternative is the browser's torn-page glyph sitting beside the
    // store's own name, which is worse than never having had a logo.
    render(<AppHeaderBrand name="Future Drink" logoUrl="/gone.png" />);

    fireEvent.error(screen.getByTestId("app-header-brand-logo"));

    expect(screen.getByTestId("app-header-brand-initials")).toHaveTextContent("FD");
    await waitFor(() =>
      expect(screen.queryByTestId("app-header-brand-logo")).not.toBeInTheDocument(),
    );
  });

  it("derives the highlight from the seed's own hue", () => {
    // The claim is that one brand colour is enough: the second stop is the same
    // colour rotated and lifted, never a fixed accent bolted onto every brand.
    const violet = highlightOf("#6366F1");
    const orange = highlightOf("#F97316");

    expect(violet).toMatch(/^#[0-9a-f]{6}$/u);
    expect(violet).not.toBe("#6366F1");
    expect(violet).not.toBe(orange);
  });

  it("leaves a hueless seed grey instead of inventing a colour for it", () => {
    // Rotating the hue of a grey produces the same grey; pretending otherwise
    // would paint a brand a colour it never chose.
    const grey = highlightOf("#9CA3AF");
    const [r, g, b] = [grey.slice(1, 3), grey.slice(3, 5), grey.slice(5, 7)].map((pair) =>
      Number.parseInt(pair, 16),
    );

    expect(Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0)).toBeLessThan(24);
  });

  it("returns an unparseable seed untouched rather than throwing", () => {
    // A tenant's config can hold anything — a CSS variable, a typo.
    expect(highlightOf("var(--brand)")).toBe("var(--brand)");
  });
});

describe("AppHeaderStatus", () => {
  it("joins its segments and drops the empty ones", () => {
    render(<AppHeaderStatus tone="success" items={["Aberto agora", "", "Retirada no balcão"]} />);

    const status = screen.getByTestId("app-header-status");
    expect(status).toHaveTextContent("Aberto agora · Retirada no balcão");
    expect(status.textContent).not.toContain("··");
  });

  it("renders nothing at all when every segment is empty", async () => {
    render(<AppHeaderStatus items={[null, undefined, ""]} />);

    await waitFor(() =>
      expect(screen.queryByTestId("app-header-status")).not.toBeInTheDocument(),
    );
  });

  it("shows the tone dot only when a tone was asked for", async () => {
    const { rerender } = render(<AppHeaderStatus tone="warning" items={["Fecha em 15 min"]} />);
    expect(screen.getByTestId("app-header-status-dot")).toBeInTheDocument();

    rerender(<AppHeaderStatus items={["Fecha em 15 min"]} />);
    await waitFor(() =>
      expect(screen.queryByTestId("app-header-status-dot")).not.toBeInTheDocument(),
    );
  });
});

describe("AppHeaderIdentity", () => {
  it("is a real button when it can disclose, and says what it opens", () => {
    const onDisclose = vi.fn();
    render(<AppHeaderIdentity title="Future Drink" onDisclose={onDisclose} />);

    const disclosure = screen.getByRole("button", { name: "Detalhes de Future Drink" });
    expect(disclosure).toHaveAttribute("aria-haspopup", "dialog");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);
    expect(onDisclose).toHaveBeenCalledTimes(1);
  });

  it("reports the open panel back through aria-expanded", () => {
    render(<AppHeaderIdentity title="Future Drink" onDisclose={vi.fn()} disclosed />);

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("is inert text — with no chevron — when there is nothing to open", async () => {
    render(<AppHeaderIdentity title="Future Drink" />);

    await waitFor(() => {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("app-header-identity-chevron")).not.toBeInTheDocument();
    });
  });

  it("holds a skeleton while the identity resolves, showing no title", async () => {
    // An app that paints a fallback name flashes the wrong brand for a frame on
    // every load — on a white-label storefront, the platform's name on a page a
    // merchant pays for it not to appear on.
    render(<AppHeaderIdentity title="Future Drink" loading />);

    expect(screen.getByTestId("app-header-identity-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Future Drink")).not.toBeInTheDocument());
  });
});

describe("AppHeaderDetails", () => {
  it("renders its rows, its action, and accents the row that asked for it", () => {
    const onClick = vi.fn();
    render(
      <AppHeaderDetails
        open
        onClose={vi.fn()}
        title="Future Drink"
        subtitle="Mercado de autoatendimento"
        rows={STORE_ROWS}
        action={{ label: "Trocar de loja", onClick }}
        presentation="dialog"
      />,
    );

    expect(screen.getByText("Aberto até 22h")).toBeInTheDocument();
    expect(screen.getByText("No balcão, na hora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trocar de loja" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the multi-line values a single row is allowed to hold", () => {
    // An address is two lines; collapsing them would run the street into the
    // neighbourhood.
    render(
      <AppHeaderDetails
        open
        onClose={vi.fn()}
        title="Future Drink"
        rows={[{ label: "Endereço", value: "Rua Padre Pedro Pinto, 1200\nVenda Nova" }]}
        presentation="dialog"
      />,
    );

    expect(screen.getByText(/Venda Nova/u)).toHaveStyle({ whiteSpace: "pre-line" });
  });

  it("takes the sheet on a narrow viewport and the dialog on a wide one", async () => {
    // The point of one component with two presentations: no call site writes
    // this branch, and nobody ships a phone-shaped sheet across a desktop.
    matchMediaReturning(true);
    const { unmount } = render(
      <AppHeaderDetails open onClose={vi.fn()} title="Future Drink" rows={STORE_ROWS} />,
    );
    expect(document.querySelector('[data-testid="app-header-details-body"]')).toBeInTheDocument();
    expect(document.querySelector(".MuiDrawer-root")).toBeInTheDocument();
    unmount();

    matchMediaReturning(false);
    render(<AppHeaderDetails open onClose={vi.fn()} title="Future Drink" rows={STORE_ROWS} />);
    expect(document.querySelector(".MuiDialog-root")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".MuiDrawer-root")).toBeNull());

    vi.unstubAllGlobals();
  });

  it("honours a forced presentation over the viewport", () => {
    matchMediaReturning(false);
    render(
      <AppHeaderDetails
        open
        onClose={vi.fn()}
        title="Future Drink"
        rows={STORE_ROWS}
        presentation="sheet"
      />,
    );

    expect(document.querySelector(".MuiDrawer-root")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
