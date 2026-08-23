/**
 * The layer the category panel lands on, as a number rather than as a snapshot.
 *
 * This defect was invisible to every rendering assertion: the panel mounted, its
 * search box was in the DOM, its testids matched — and the panel was UNDER the
 * sheet that opened it, which only a z-index comparison against the sheet's own
 * ladder can state. So that comparison is the test.
 */
import { PT_BR_CATEGORY_SELECT_COPY } from "../../../../pt-BR";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../../../feedback/StackedModal";
import {
  MODAL_STACK_BASE_Z_INDEX,
  MODAL_STACK_Z_INDEX_STEP,
  STACKED_OVERLAY_CLEARED_LEVELS,
} from "../../../../tokens/layers";
import { CategorySelect } from "../CategorySelect";

const OPTIONS = [{ id: "c1", name: "Acompanhamentos", parentId: null }];

/**
 * Answers `max-width` queries with `true` so `useMediaQuery` reports a phone —
 * jsdom otherwise matches nothing and `CategorySelect` always takes its pointer
 * branch, leaving the bottom-sheet surface unrendered and unasserted.
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

/** The z-index actually painted on a node, resolved through the class emotion gave it. */
function paintedZIndex(node: Element): number {
  return Number(getComputedStyle(node).zIndex);
}

/**
 * The picker inside `depth` stacked sheets — one is the ordinary case, two is
 * the one that broke: a sheet that opens another sheet.
 */
function renderInSheets(depth: number): void {
  const panel = (
    <CategorySelect copy={PT_BR_CATEGORY_SELECT_COPY} mode="single" value={null} onChange={() => undefined} options={OPTIONS} dataTestId="cat" />
  );
  render(
    <StackedModalProvider>
      <StackedModal backLabel="Voltar" open onClose={() => undefined} modalId="outer" dataTestId="outer-sheet">
        {depth > 1 ? (
          <StackedModal backLabel="Voltar" open onClose={() => undefined} modalId="inner" dataTestId="inner-sheet">
            {panel}
          </StackedModal>
        ) : (
          panel
        )}
      </StackedModal>
    </StackedModalProvider>,
  );
}

describe("CategorySelect panel layer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([1, 2])("opens above a stack of %i sheet(s)", (depth) => {
    renderInSheets(depth);
    fireEvent.click(screen.getByTestId("cat-trigger"));

    const popover = document.querySelector(".MuiPopover-root");
    expect(popover).not.toBeNull();

    // The deepest panel this stack reaches. At depth 2 it is 1310 — the number
    // the panel used to lose to while sitting on `zIndex.modal` (1300).
    const deepestSheet = MODAL_STACK_BASE_Z_INDEX + (depth - 1) * MODAL_STACK_Z_INDEX_STEP;
    expect(paintedZIndex(popover as Element)).toBeGreaterThan(deepestSheet);
  });

  it("clears every panel the headroom promises, not just the one in the test", () => {
    renderInSheets(1);
    fireEvent.click(screen.getByTestId("cat-trigger"));

    const painted = paintedZIndex(document.querySelector(".MuiPopover-root") as Element);
    const deepestCleared =
      MODAL_STACK_BASE_Z_INDEX + (STACKED_OVERLAY_CLEARED_LEVELS - 1) * MODAL_STACK_Z_INDEX_STEP;
    expect(painted).toBeGreaterThan(deepestCleared);
  });

  it("lifts the bottom sheet too, which starts a step lower than the popover", () => {
    // Under `METRICS.sheetBreakpoint` the panel is a `Drawer`, whose default is
    // `zIndex.drawer` (1200) — buried by the same sheet, only deeper. Its own
    // case because a fix applied to the Popover alone leaves every phone-width
    // consumer exactly as broken as before.
    stubPhoneViewport();
    renderInSheets(2);
    fireEvent.click(screen.getByTestId("cat-trigger"));

    const drawer = document.querySelector(".MuiDrawer-root");
    expect(drawer).not.toBeNull();

    const deepestSheet = MODAL_STACK_BASE_Z_INDEX + MODAL_STACK_Z_INDEX_STEP;
    expect(paintedZIndex(drawer as Element)).toBeGreaterThan(deepestSheet);
  });
});
