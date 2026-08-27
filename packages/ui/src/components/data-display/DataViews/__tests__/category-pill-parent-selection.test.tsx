/**
 * `allowParentSelection` through the FILTER PILL — the consumer half.
 *
 * The flag has existed on `CategorySelect` since the picker shipped, and the
 * discounts target picker uses it. What never existed was a way for a GRID to
 * ask for it: `PillControl` builds the picker itself, so a screen declaring a
 * `control: "category"` field had no say, and every DataViews category filter
 * was silently leaf-only. Estoque is the screen that made that visible.
 *
 * These pin the whole matrix, because the failure mode of a forwarded prop is
 * that it quietly stops being forwarded and nothing goes red.
 */
import { fireEvent, render, screen } from "./test-utils";
import { describe, expect, it, vi } from "vitest";

import { PillControl } from "../data-views-category-pill";
import type { FilterFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  name: string;
}

/** Two parents with children, one without — the shape the matrix needs. */
const OPTIONS = [
  { value: "beb", label: "Bebidas", parentId: null },
  { value: "beb.agua", label: "Águas", parentId: "beb" },
  { value: "beb.refri", label: "Refrigerantes", parentId: "beb" },
  { value: "cong", label: "Congelados", parentId: null },
];

function renderPill(
  allowParentSelection: boolean | undefined,
  selected: string[] = [],
): ReturnType<typeof vi.fn> {
  const onTogglePill = vi.fn();
  const pill: FilterFieldConfig<Row> = {
    id: "categoria",
    label: "Categoria",
    control: "category",
    options: OPTIONS,
    ...(allowParentSelection === undefined ? {} : { allowParentSelection }),
  };
  render(
    <PillControl
      fieldId="categoria"
      pill={pill}
      selected={selected}
      onTogglePill={onTogglePill}
      onClearField={() => undefined}
      testIdPrefix="grid"
    />,
  );
  fireEvent.click(screen.getByTestId("grid-filter-categoria-trigger"));
  return onTogglePill;
}

const apply = (): void => {
  fireEvent.click(screen.getByTestId("grid-filter-categoria-apply"));
};

describe("allowParentSelection ON", () => {
  it("selects every child when a parent WITH children is picked", () => {
    const onTogglePill = renderPill(true);

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-beb"));
    apply();

    // Rule: picking the parent picks all of its children.
    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.agua", true);
    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.refri", true);
  });

  it("clears every child when a fully-picked parent is unpicked", () => {
    const onTogglePill = renderPill(true, ["beb.agua", "beb.refri"]);

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-beb"));
    apply();

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.agua", false);
    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.refri", false);
  });

  it("selects a parent with NO children as itself", () => {
    const onTogglePill = renderPill(true);

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-cong"));
    apply();

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "cong", true);
  });
});

describe("allowParentSelection OFF (the default)", () => {
  it("leaves a parent WITH children unselectable — only its children tick", () => {
    const onTogglePill = renderPill(undefined);

    // The head row is present (it discloses its children) but carries no
    // selection state, so clicking it only folds.
    const head = screen.getByTestId("grid-filter-categoria-category-beb");
    expect(head).toHaveAttribute("role", "button");
    expect(head).not.toHaveAttribute("aria-selected");

    fireEvent.click(screen.getByTestId("grid-filter-categoria-option-beb.agua"));
    apply();

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.agua", true);
    expect(onTogglePill).not.toHaveBeenCalledWith("categoria", "beb", true);
  });

  it("still selects a parent with NO children — it IS the leaf", () => {
    const onTogglePill = renderPill(false);

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-cong"));
    apply();

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "cong", true);
  });
});
