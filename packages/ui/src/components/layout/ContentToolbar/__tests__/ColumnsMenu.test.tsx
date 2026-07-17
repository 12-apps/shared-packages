import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ColumnsMenu } from "../ColumnsMenu";
import type { ColumnVisibilityOption } from "../ContentToolbar.types";

const columns: ColumnVisibilityOption[] = [
  { id: "name", label: "Nome", visible: true },
  { id: "sku", label: "SKU", visible: false },
];

function renderMenu(overrides: Partial<React.ComponentProps<typeof ColumnsMenu>> = {}) {
  const onToggle = vi.fn();
  render(<ColumnsMenu columns={columns} onToggle={onToggle} data-testid="cols" {...overrides} />);
  return onToggle;
}

describe("ColumnsMenu", () => {
  it("opens and lists each column with its visibility", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("cols"));
    expect(screen.getByTestId("cols-name")).toBeInTheDocument();
    expect(screen.getByTestId("cols-sku")).toBeInTheDocument();
  });

  it("toggles a hidden column on", () => {
    const onToggle = renderMenu();
    fireEvent.click(screen.getByTestId("cols"));
    fireEvent.click(screen.getByTestId("cols-sku"));
    expect(onToggle).toHaveBeenCalledWith("sku", true);
  });

  it("toggles a visible column off", () => {
    const onToggle = renderMenu();
    fireEvent.click(screen.getByTestId("cols"));
    fireEvent.click(screen.getByTestId("cols-name"));
    expect(onToggle).toHaveBeenCalledWith("name", false);
  });
});
