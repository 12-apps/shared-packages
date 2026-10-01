/**
 * The phone's select-all box beside the count (FUT-3184).
 *
 * It read CHECKED for any selection: one row of twenty ticked showed a full
 * tick above a table header that, correctly, read partial. Given `allSelected`
 * it now agrees with the header — checked only when everything is ticked,
 * partial otherwise — and a partial box selects the rest, as the header does.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ContentToolbar } from "../ContentToolbar";

function renderToolbar(props: { hasSelection: boolean; allSelected?: boolean }) {
  const selectAll = vi.fn();
  const clearSelection = vi.fn();
  render(
    <ContentToolbar
      selectAllText="Selecionar todos nesta página"
      clearAllText="Limpar filtros"
      selectAllLabel="Selecionar tudo"
      selectedCount={props.hasSelection ? 1 : 0}
      selectedCountLabel={(n) => `${n} ${n === 1 ? "selecionado" : "selecionados"}`}
      selectAll={selectAll}
      clearSelection={clearSelection}
      rightControls={null}
      selectAllTestId="t-select-all"
      clearAllTestId="t-clear-all"
      {...props}
    />,
  );
  const box = screen.getByTestId("t-select-all-checkbox").querySelector("input") as HTMLInputElement;
  return { box, selectAll, clearSelection };
}

describe("the select-all box beside the count", () => {
  it("reads partial while only some rows are ticked, and selects the rest", () => {
    const { box, selectAll, clearSelection } = renderToolbar({ hasSelection: true, allSelected: false });
    expect(box).toHaveAttribute("data-indeterminate", "true");
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(selectAll).toHaveBeenCalledOnce();
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it("reads checked when everything is ticked, and clears", () => {
    const { box, selectAll, clearSelection } = renderToolbar({ hasSelection: true, allSelected: true });
    expect(box.checked).toBe(true);
    expect(box).toHaveAttribute("data-indeterminate", "false");
    fireEvent.click(box);
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("keeps the old reading when the host does not say", () => {
    const { box, clearSelection } = renderToolbar({ hasSelection: true });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(clearSelection).toHaveBeenCalledOnce();
  });
});
