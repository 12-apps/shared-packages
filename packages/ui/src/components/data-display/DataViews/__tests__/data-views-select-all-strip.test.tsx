import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { SelectAllStrip } from "../data-views-select-all-strip";

/**
 * SELECT-ALL FOR THE LAYOUTS WITH NO HEADER ROW.
 *
 * The table's `<thead>` carries a checkbox; the cards, the list and the board
 * carry nothing. Without this there is no way to BEGIN a selection in those
 * three except clicking an item, and "everything on this page" costs one click
 * per row.
 */

interface Row extends Record<string, unknown> {
  id: string;
}

const rows: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];

function renderStrip(selected: string[], onChange = vi.fn(), pageRows: Row[] = rows) {
  render(
    <ThemeProvider theme={createTheme()}>
      <SelectAllStrip
        rows={pageRows}
        getRowId={(row) => row.id}
        selectedIds={new Set(selected)}
        onChange={onChange}
        testIdPrefix="lista"
      />
    </ThemeProvider>,
  );
  return onChange;
}

/** The strip's real checkbox input (the testid sits on the MUI root). */
function box(): HTMLInputElement {
  const input = screen.getByTestId("lista-select-all-box").querySelector("input");
  if (!input) throw new Error("checkbox input not found");
  return input;
}

describe("the select-all strip", () => {
  it("renders nothing for an empty page — a select-all over zero rows does nothing", async () => {
    // Presence evidence first: the strip DOES render for a non-empty page, so
    // its absence below is the deliberate one and not a race.
    const { unmount } = render(
      <ThemeProvider theme={createTheme()}>
        <SelectAllStrip
          rows={rows}
          getRowId={(row) => row.id}
          selectedIds={new Set()}
          onChange={vi.fn()}
          testIdPrefix="lista"
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("lista-select-all-strip")).toBeInTheDocument();
    unmount();

    renderStrip([], vi.fn(), []);
    await waitFor(() => expect(screen.queryByTestId("lista-select-all-strip")).toBeNull());
  });

  it("selects every row on the page, and says how many that is", () => {
    const onChange = renderStrip([]);
    expect(screen.getByTestId("lista-select-all-strip")).toHaveTextContent("3 nesta página");

    fireEvent.click(screen.getByTestId("lista-select-all-toggle"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(["a", "b", "c"]);
  });

  it("goes indeterminate on a partial selection, not checked and not empty", () => {
    renderStrip(["a"]);
    // Both two-state answers would be wrong here, so the third is used. MUI
    // reports it on the input as `data-indeterminate` (the DOM property is set
    // by its own ref, not by the React attribute).
    expect(box()).toHaveAttribute("data-indeterminate", "true");
    expect(box().checked).toBe(false);
  });

  it("offers to clear once the whole page is selected", () => {
    const onChange = renderStrip(["a", "b", "c"]);
    expect(box().checked).toBe(true);
    expect(screen.getByTestId("lista-select-all-toggle")).toHaveTextContent("Limpar seleção");

    fireEvent.click(screen.getByTestId("lista-select-all-toggle"));
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual([]);
  });

  it("clears only THIS page — a selection made on another page is not its to drop", () => {
    // "z" was selected on a previous page and is not among the loaded rows.
    const onChange = renderStrip(["a", "b", "c", "z"]);
    fireEvent.click(screen.getByTestId("lista-select-all-toggle"));
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(["z"]);
  });

  it("adds this page to an existing selection rather than replacing it", () => {
    const onChange = renderStrip(["z"]);
    fireEvent.click(screen.getByTestId("lista-select-all-toggle"));
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(["z", "a", "b", "c"]);
  });
});
