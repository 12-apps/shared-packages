/**
 * StackedModal on iOS: the slide-over panel is `position: fixed` and full-height,
 * so it must be sized against the DYNAMIC viewport. With `100vh` the panel runs
 * underneath the mobile browser toolbar, which leaves the tail of the scroll area
 * — the "Criar produto" submit row — permanently out of reach: overscrolling to
 * it rubber-bands and springs straight back.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider, type PanelWidth } from "../index";

/**
 * Answers `max-width` media queries with `true` so `useMediaQuery` reports a
 * phone — jsdom otherwise matches nothing and the modal always renders in its
 * desktop shape (actions in the header, no bottom action bar).
 */
function stubPhoneViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** All CSS emotion has injected into the document, as one searchable string. */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((tag) => {
      // Emotion writes rules through the CSSOM in "speedy" mode, leaving the
      // tag's text empty — read both shapes so this holds either way.
      const fromRules = Array.from(tag.sheet?.cssRules ?? [])
        .map((rule) => rule.cssText)
        .join("");
      return `${tag.textContent ?? ""}${fromRules}`;
    })
    .join("");
}

function renderModal(actions?: React.ReactNode, size?: "default" | "wide", panelWidth?: PanelWidth): void {
  render(
    <StackedModalProvider>
      <StackedModal backLabel="Voltar"
        size={size}
        panelWidth={panelWidth}
        open
        onClose={() => undefined}
        navigationTitle="Novo produto"
        modalId="viewport-spec"
        dataTestId="viewport-modal"
        actions={actions}
      >
        <div>corpo</div>
      </StackedModal>
    </StackedModalProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StackedModal viewport sizing", () => {
  it("pins the panel to the dynamic viewport instead of a bare 100vh", async () => {
    renderModal();
    await screen.findByTestId("viewport-modal-header");

    const css = injectedCss();
    expect(css).toContain("100dvh");
    // The dvh sizing must be guarded so browsers without dynamic viewport units
    // still get the 100vh fallback rather than no height at all.
    expect(css).toContain("@supports (height: 100dvh)");
    expect(css).toContain("100vh");
  });

  it("lets the scroll area own its overscroll so it can't rubber-band the panel", async () => {
    renderModal();
    const content = await screen.findByTestId("viewport-modal-content");

    expect(injectedCss()).toContain("overscroll-behavior:contain");
    expect(content).toBeInTheDocument();
  });

  it("clears the home indicator under the mobile action bar", async () => {
    stubPhoneViewport();
    renderModal(<button type="button">Criar</button>);

    // On a phone the actions move out of the header into a pinned bottom bar…
    const footer = await screen.findByTestId("viewport-modal-footer");
    expect(footer).toHaveTextContent("Criar");
    // …which pads past its own 16px by the home-indicator inset.
    expect(injectedCss()).toContain(
      "max(16px, calc(16px + env(safe-area-inset-bottom)))",
    );
  });
});

describe("StackedModal size", () => {
  it("keeps the default viewport shares when no size is given", async () => {
    renderModal();
    await screen.findByTestId("viewport-modal-header");
    const css = injectedCss();
    expect(css).toMatch(/max-width:\s*60vw/);
    // The wide keyframes are always registered; the SETTLED width is what differs.
    expect(css).not.toMatch(/max-width:\s*90vw/);
  });

  it("gives a wide panel 90vw up to xl and 75vw above it", async () => {
    renderModal(undefined, "wide");
    await screen.findByTestId("viewport-modal-header");
    const css = injectedCss();
    expect(css).toMatch(/max-width:\s*90vw/);
    expect(css).toMatch(/max-width:\s*75vw/);
    // The keyframes a wide panel animates with end where it settles, or it snaps.
    expect(css).toContain("contractModalWide");
  });

  it("does not forward the size to the DOM", async () => {
    renderModal(undefined, "wide");
    const header = await screen.findByTestId("viewport-modal-header");
    const paper = header.closest(".MuiDialog-paper");
    expect(paper).toBeInTheDocument();
    expect(paper?.hasAttribute("panelsize")).toBe(false);
    expect(paper?.hasAttribute("panelSize")).toBe(false);
  });
});

describe("StackedModal panelWidth", () => {
  const SHEET: PanelWidth = { share: "72vw", maxPx: 1040, fullBelowPx: 1000 };

  it("takes min(share, cap) of the viewport, read from the viewport alone", async () => {
    renderModal(undefined, undefined, SHEET);
    await screen.findByTestId("viewport-modal-header");
    const css = injectedCss();
    expect(css).toMatch(/--stacked-modal-width:\s*min\(72vw,\s*65rem\)/);
    expect(css).toMatch(/max-width:\s*var\(--stacked-modal-width\)/);
  });

  it("takes the whole screen under fullBelowPx", async () => {
    renderModal(undefined, undefined, SHEET);
    await screen.findByTestId("viewport-modal-header");
    expect(injectedCss()).toMatch(/@media \(max-width:\s*999\.98px\)\s*\{[^}]*--stacked-modal-width:\s*100%/);
  });

  it("animates to its own width, and keeps the prop off the DOM", async () => {
    renderModal(undefined, undefined, SHEET);
    const header = await screen.findByTestId("viewport-modal-header");
    expect(injectedCss()).toContain("contractModalExact");
    expect(header.closest(".MuiDialog-paper")?.hasAttribute("panelwidth")).toBe(false);
  });
});
