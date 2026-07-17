import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SavedViewsMenu } from "../SavedViewsMenu";
import type { SavedViewLike } from "../ContentToolbar.types";

const views: SavedViewLike[] = [
  { id: "v1", name: "Meus ativos", shared: false, pinned: true, isDefault: true, isOwner: true },
  { id: "v2", name: "Da equipe", shared: true, pinned: false, isDefault: false, isOwner: false },
];

function renderMenu(overrides: Partial<React.ComponentProps<typeof SavedViewsMenu>> = {}) {
  const handlers = {
    onApply: vi.fn(),
    onSelectMain: vi.fn(),
    onSaveCurrent: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSetDefault: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleShare: vi.fn(),
    onManageAll: vi.fn(),
  };
  render(<SavedViewsMenu views={views} testIdPrefix="views" {...handlers} {...overrides} />);
  return handlers;
}

describe("SavedViewsMenu", () => {
  it("lists pinned + recent sections and a default badge", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    expect(screen.getByTestId("views-section-pinned")).toBeInTheDocument();
    expect(screen.getByTestId("views-section-recent")).toBeInTheDocument();
    expect(screen.getByTestId("views-default-v1")).toBeInTheDocument();
  });

  it("labels the trigger 'Visão principal' by default and the active view name when set", () => {
    const noop = {
      onApply: vi.fn(),
      onSelectMain: vi.fn(),
      onSaveCurrent: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSetDefault: vi.fn(),
      onTogglePin: vi.fn(),
      onToggleShare: vi.fn(),
      onManageAll: vi.fn(),
    };
    const { rerender } = render(<SavedViewsMenu views={views} testIdPrefix="views" {...noop} />);
    expect(screen.getByTestId("views-button")).toHaveTextContent("Visão principal");
    rerender(<SavedViewsMenu views={views} activeViewName="Meus ativos" testIdPrefix="views" {...noop} />);
    expect(screen.getByTestId("views-button")).toHaveTextContent("Meus ativos");
  });

  it("offers a Main vision default that resets to the no-filter view", () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    fireEvent.click(screen.getByTestId("views-main"));
    expect(handlers.onSelectMain).toHaveBeenCalled();
  });

  it("applies a view when its name is clicked", () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    fireEvent.click(screen.getByTestId("views-apply-v1"));
    expect(handlers.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
  });

  it("shows full owner actions (incl. Excluir) for an owned view", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    fireEvent.click(screen.getByTestId("views-kebab-v1"));
    expect(screen.getByTestId("views-item-delete-v1")).toBeInTheDocument();
    expect(screen.getByText("Excluir")).toBeInTheDocument();
  });

  it("shows apply-only for a non-owned shared view", async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    fireEvent.click(screen.getByTestId("views-kebab-v2"));
    expect(screen.getByTestId("views-item-apply-v2")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("views-item-delete-v2")).not.toBeInTheDocument();
    });
  });

  it("offers save-current and manage-all", () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId("views-button"));
    fireEvent.click(screen.getByTestId("views-save-current"));
    expect(handlers.onSaveCurrent).toHaveBeenCalled();
  });

  it("shows an empty hint when there are no views", () => {
    renderMenu({ views: [] });
    fireEvent.click(screen.getByTestId("views-button"));
    expect(within(screen.getByTestId("views-popover")).getByText(/Nenhuma visão salva/i)).toBeInTheDocument();
  });
});
