/**
 * EVERY "LIMPAR FILTROS" EMPTIES A DAY THE FILTER REFUSED (FUT-4144).
 *
 * A day field keeps a refused `31/02/2026` on screen, red, until its applied
 * bound moves. A clear-all under a range that was never applied writes `{}`
 * over `{}` — no state moves — so on its own it left the red day behind. The
 * controller's `clearFilters` bumps a `clearKey` the filter controls are keyed
 * on; these drive the real grid through each surface that clears.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn, RangeFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  day: string;
}

const rows: Row[] = [
  { id: "1", name: "Ana", day: "2026-08-06" },
  { id: "2", name: "Bruno", day: "2026-08-07" },
];

const columns: DataViewColumn<Row>[] = [{ id: "name", header: "Nome", accessor: "name", searchable: true }];
const rangeFields: RangeFieldConfig<Row>[] = [
  { id: "day", label: "Data", kind: "day", accessor: (row) => row.day, presets: [] },
];

function renderGrid() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        rangeFields={rangeFields}
        getRowId={(row) => row.id}
        dataTestId="people"
        testIdPrefix="people"
      />
    </ThemeProvider>,
  );
}

const dayMin = (): HTMLInputElement => screen.getByTestId("people-range-day-min") as HTMLInputElement;

/** A refused day in the panel's `De`, with no bound applied: red, and kept on blur. */
async function refuseDay(): Promise<void> {
  fireEvent.change(dayMin(), { target: { value: "31022026" } });
  fireEvent.blur(dayMin());
  await waitFor(() => expect(dayMin()).toHaveAttribute("aria-invalid", "true"));
  expect(dayMin()).toHaveValue("31/02/2026");
}

describe("clearing every filter empties a refused day under an open range", () => {
  beforeEach(() => window.localStorage.clear());

  it("from the empty state's Limpar filtros", async () => {
    renderGrid();
    const search = screen.getByTestId("people-search-all");
    fireEvent.change(search, { target: { value: "ninguém" } });
    fireEvent.blur(search);
    await refuseDay();

    fireEvent.click(await screen.findByTestId("people-empty-clear"));

    await waitFor(() => expect(dayMin()).toHaveValue(""));
    expect(dayMin()).toHaveAttribute("aria-invalid", "false");
    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument());
  });

  it("from the slide-in panel's Limpar todos os filtros", async () => {
    renderGrid();
    await refuseDay();

    fireEvent.click(screen.getByTestId("people-clear-filters"));

    await waitFor(() => expect(dayMin()).toHaveValue(""));
    expect(dayMin()).toHaveAttribute("aria-invalid", "false");
  });
});
