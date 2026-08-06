import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { SaveViewModal } from "../SaveViewModal";
import type { DataViewColumn, DataViewState, FilterFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome" },
  { id: "status", header: "Status" },
];

const fields: FilterFieldConfig<Row>[] = [
  { id: "status", label: "Status", options: [{ value: "ACTIVE", label: "Ativo" }] },
];

const currentState: DataViewState = {
  search: "",
  pills: { status: ["ACTIVE"] },
  sortBy: [],
  // "status" hidden, so the summary has a change to report for columns.
  visibleColumns: ["name"],
};

function renderModal(onSave = vi.fn()) {
  render(
    <ThemeProvider theme={createTheme()}>
      <SaveViewModal<Row>
        open
        onClose={vi.fn()}
        currentState={currentState}
        fields={fields}
        columns={columns}
        onSave={onSave}
        testIdPrefix="views"
      />
    </ThemeProvider>,
  );
  return onSave;
}

describe("SaveViewModal", () => {
  it("summarises what the view CHANGES — its filters and the columns it hides", () => {
    renderModal();
    const filters = screen.getByTestId("views-preview-filters");
    expect(within(filters).getByText("Status: Ativo")).toBeInTheDocument();
    // The columns row names what is HIDDEN, not the eight that are not.
    const cols = screen.getByTestId("views-preview-columns");
    expect(within(cols).getByText("Status")).toBeInTheDocument();
    // Not a removal — "Nome" is visible and simply never listed as hidden.
    expect(within(cols).getByText("Status")).not.toHaveTextContent("Nome");
  });

  it("requires a name before saving", () => {
    renderModal();
    expect(screen.getByTestId("views-save-submit")).toBeDisabled();
  });

  it("saves the entered name + share toggle", () => {
    const onSave = renderModal();
    fireEvent.change(screen.getByTestId("views-save-name"), { target: { value: "Baixo estoque" } });
    fireEvent.click(screen.getByTestId("views-save-shared")); // the switch input carries the testid
    fireEvent.click(screen.getByTestId("views-save-submit"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Baixo estoque", shared: true, pinned: false, isDefault: false }),
    );
  });

  it("surfaces the error and keeps the modal open when the save is rejected", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Já existe uma visão com esse nome."));
    renderModal(onSave);
    fireEvent.change(screen.getByTestId("views-save-name"), { target: { value: "Duplicada" } });
    fireEvent.click(screen.getByTestId("views-save-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("views-save-error")).toHaveTextContent(/já existe uma visão/i),
    );
    // Still open + the button re-enabled for a retry.
    expect(screen.getByTestId("views-save-submit")).toBeEnabled();
  });
});
