/**
 * PickerSheet driven through the DOM: what a query shows, what each gesture
 * calls, and how the dialog names and marks itself.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackedModal, StackedModalProvider } from "../../../feedback/StackedModal";
import { MODAL_STACK_BASE_Z_INDEX, MODAL_STACK_Z_INDEX_STEP } from "../../../../tokens/layers";
import { PickerSheet } from "../PickerSheet";
import type { PickerSheetItem, PickerSheetProps } from "../PickerSheet.types";
import { pickerSheetView, stepActiveIndex } from "../picker-sheet-model";

const ITEMS: PickerSheetItem[] = [
  { id: "drinks", label: "Drinks", indent: 0 },
  { id: "juices", label: "Juices", meta: "Drinks › Juices", indent: 1, selected: true },
  { id: "sodas", label: "Sodas", meta: "Drinks › Sodas", indent: 1 },
  { id: "desserts", label: "Desserts", indent: 0 },
];

type Overrides = Partial<PickerSheetProps>;

function renderSheet(overrides: Overrides = {}) {
  const props: PickerSheetProps = {
    open: true,
    onClose: vi.fn(),
    kicker: "Product",
    title: "Choose a category",
    searchPlaceholder: "Search categories",
    searchLabel: "Search categories",
    closeLabel: "Close",
    items: ITEMS,
    onPick: vi.fn(),
    dataTestId: "ps",
    ...overrides,
  };
  const { rerender } = render(<PickerSheet {...props} />);
  return { props, rerender };
}

const search = (): HTMLElement => screen.getByTestId("ps-search");
const enterQuery = (text: string): void => {
  fireEvent.change(search(), { target: { value: text } });
};
const rowIds = (): string[] =>
  within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((row) => row.getAttribute("data-testid") ?? "");

/** Answers `max-width` queries with `true` so `useMediaQuery` reports a phone. */
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

describe("PickerSheet", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is a dialog named by its title", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Choose a category" })).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
  });

  it("is named by its title as a bottom sheet too", () => {
    stubPhoneViewport();
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Choose a category" });
    expect(dialog.closest(".MuiDrawer-root")).not.toBeNull();
  });

  it("focuses the search box on open", async () => {
    renderSheet();
    await waitFor(() => expect(search()).toHaveFocus());
  });

  it("filters case-insensitively on label and meta", () => {
    renderSheet();
    enterQuery("JUI");
    expect(rowIds()).toEqual(["ps-item-juices"]);

    // "drinks" is in the meta line of both children, and the parent's label.
    enterQuery("drinks");
    expect(rowIds()).toEqual(["ps-item-drinks", "ps-item-juices", "ps-item-sodas"]);
  });

  it("matches on searchText when given, instead of label and meta", () => {
    renderSheet({ items: [{ id: "a", label: "Apple", searchText: "fruit" }, { id: "b", label: "Bread" }] });
    enterQuery("fruit");
    expect(rowIds()).toEqual(["ps-item-a"]);
  });

  it("offers the create row only when no label matches exactly, and calls onCreate with the trimmed query", () => {
    const onCreate = vi.fn();
    renderSheet({ onCreate, createLabel: (query) => `Create "${query}"` });

    enterQuery("Sod");
    expect(screen.getByTestId("ps-create")).toHaveTextContent('Create "Sod"');

    enterQuery("  sodas ");
    expect(rowIds()).toEqual(["ps-item-sodas"]);

    enterQuery("  Teas ");
    fireEvent.click(screen.getByTestId("ps-create"));
    expect(onCreate).toHaveBeenCalledWith("Teas");
  });

  it("shows the empty text when nothing matches and nothing can be created", () => {
    renderSheet({ emptyText: (query) => `Nothing for "${query}"` });
    enterQuery("zzz");
    expect(screen.getByTestId("ps-empty")).toHaveTextContent('Nothing for "zzz"');
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("calls onPick on click, and nothing else", () => {
    const { props } = renderSheet();
    fireEvent.click(screen.getByTestId("ps-item-sodas"));
    expect(props.onPick).toHaveBeenCalledWith("sodas");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("picks the cursor's row on Enter after ArrowDown, wrapping at the ends", () => {
    const { props } = renderSheet();
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(search()).toHaveAttribute("aria-activedescendant", screen.getByTestId("ps-item-juices").id);
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("juices");

    fireEvent.keyDown(search(), { key: "ArrowUp" });
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(props.onPick).toHaveBeenLastCalledWith("desserts");
  });

  it("creates on Enter when the create row is the only row", () => {
    const onCreate = vi.fn();
    renderSheet({ onCreate, createLabel: (query) => `Create "${query}"` });
    enterQuery("Teas");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Teas");
  });

  it("calls onClose on Esc and on the close button", () => {
    const { props } = renderSheet();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose on a tap outside", () => {
    const { props } = renderSheet();
    const backdrop = document.querySelector(".MuiBackdrop-root") as Element;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("marks the selected row with aria-selected and a check mark", () => {
    renderSheet();
    expect(screen.getByTestId("ps-item-juices")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("ps-item-sodas")).toHaveAttribute("aria-selected", "false");
    expect(within(screen.getByTestId("ps-item-juices")).getByTestId("ps-check-juices")).toBeInTheDocument();
    expect(within(screen.getByTestId("ps-item-sodas")).queryAllByTestId(/^ps-check-/)).toHaveLength(0);
  });

  it("indents by depth with an empty query, and drops the indent while searching", () => {
    renderSheet();
    expect(screen.getByTestId("ps-item-juices")).toHaveAttribute("data-indent", "1");
    expect(screen.getByTestId("ps-item-drinks")).toHaveAttribute("data-indent", "0");

    enterQuery("ju");
    expect(screen.getByTestId("ps-item-juices")).toHaveAttribute("data-indent", "0");
  });

  it("resets the query each time it opens", () => {
    const { props, rerender } = renderSheet();
    enterQuery("ju");
    rerender(<PickerSheet {...props} open={false} />);
    rerender(<PickerSheet {...props} open />);
    expect(search()).toHaveValue("");
    expect(rowIds()).toHaveLength(ITEMS.length);
  });

  it("opens above a stack of two sheets", () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Back" open onClose={() => undefined} modalId="outer" dataTestId="outer">
          <StackedModal backLabel="Back" open onClose={() => undefined} modalId="inner" dataTestId="inner">
            <PickerSheet
              open
              onClose={() => undefined}
              title="Choose"
              searchPlaceholder="Search"
              searchLabel="Search"
              closeLabel="Close"
              items={ITEMS}
              onPick={() => undefined}
              dataTestId="ps"
            />
          </StackedModal>
        </StackedModal>
      </StackedModalProvider>,
    );
    // StackedModal is a Dialog too: find the root this sheet's own paper sits in.
    const root = screen.getByTestId("ps").closest(".MuiDialog-root") as Element;
    const deepestSheet = MODAL_STACK_BASE_Z_INDEX + MODAL_STACK_Z_INDEX_STEP;
    expect(Number(getComputedStyle(root).zIndex)).toBeGreaterThan(deepestSheet);
  });
});

describe("picker-sheet-model", () => {
  it("never offers create for an empty query or without a creator", () => {
    expect(pickerSheetView(ITEMS, "   ", true).canCreate).toBe(false);
    expect(pickerSheetView(ITEMS, "Teas", false).canCreate).toBe(false);
    expect(pickerSheetView(ITEMS, "Teas", true)).toMatchObject({ canCreate: true, rowCount: 1 });
  });

  it("steps the cursor the Command way", () => {
    expect(stepActiveIndex(-1, 1, 3)).toBe(0);
    expect(stepActiveIndex(-1, -1, 3)).toBe(2);
    expect(stepActiveIndex(2, 1, 3)).toBe(0);
    expect(stepActiveIndex(0, -1, 3)).toBe(2);
    expect(stepActiveIndex(0, 1, 0)).toBe(-1);
  });
});
