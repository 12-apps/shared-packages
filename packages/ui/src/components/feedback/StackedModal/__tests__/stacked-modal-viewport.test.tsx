/**
 * StackedModal on iOS: the slide-over panel is `position: fixed` and full-height,
 * so it must be sized against the DYNAMIC viewport. With `100vh` the panel runs
 * underneath the mobile browser toolbar, which leaves the tail of the scroll area
 * — the "Criar produto" submit row — permanently out of reach: overscrolling to
 * it rubber-bands and springs straight back.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../index";

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

function renderModal(actions?: React.ReactNode): void {
  render(
    <StackedModalProvider>
      <StackedModal
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
