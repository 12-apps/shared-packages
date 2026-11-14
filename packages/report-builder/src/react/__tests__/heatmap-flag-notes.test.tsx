// @vitest-environment jsdom
/**
 * FUT-4063: a built-in draws its heat map, marks its flagged rows (never colour
 * alone), puts a note under its block or under a KPI figure, and caps a note's
 * list at three names.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { blockNotes, figureHints, isNoteShown, noteText } from "../lib/report-notes";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import { ReportNotes } from "../report-notes";
import { exportColumnsFor, ReportRenderView } from "../report-render";
import type { ReportNoteView, ReportRender } from "../reports-api";
import { renderWithCopy as render } from "./with-copy";

afterEach(() => {
  cleanup();
});

const COPY = PT_BR_REPORT_SCREENS_COPY.system;

const FLAGGED_TABLE: ReportRender = {
  kind: "table",
  columns: [
    { key: "day", label: "Dia", format: "text" },
    { key: "ratio", label: "Custo / vendas", format: "percent" },
  ],
  rows: [
    { day: "Seg 09/11", ratio: 0.25 },
    { day: "Ter 10/11", ratio: 0.34 },
    { day: "Qua 11/11", ratio: null },
  ],
  flag: { column: "ratio", label: "acima da meta", rows: [1, 2] },
};

const HEATMAP: ReportRender = {
  kind: "heatmap",
  rowAxis: [
    { key: "1-seg", label: "Seg" },
    { key: "2-ter", label: "Ter" },
  ],
  columnAxis: [
    { key: "10", label: "10h" },
    { key: "11", label: "11h" },
  ],
  cells: [
    { row: "1-seg", column: "10", value: 0.584 },
    { row: "1-seg", column: "11", value: 0.2 },
    { row: "2-ter", column: "10", value: null },
  ],
  scale: { target: 0.3, strongAbove: 0.45, strongBelow: 0.18 },
  labels: { above: "acima da meta", below: "abaixo da meta", empty: "sem venda na hora" },
  valueFormat: "percent",
  tableColumns: [
    { key: "weekday", label: "Dia da semana", format: "text" },
    { key: "hour", label: "Hora", format: "text" },
    { key: "ratio", label: "Custo / vendas", format: "percent" },
  ],
  rows: [{ weekday: "1-seg", hour: "10", ratio: 0.584 }],
};

describe("a flagged table", () => {
  it("marks the flagged rows' judged cell with an icon and the flag's words", () => {
    render(<ReportRenderView render={FLAGGED_TABLE} dataTestId="r" />);
    const rows = within(screen.getByTestId("r-table")).getAllByRole("row");
    // Header + three rows.
    expect(rows).toHaveLength(4);
    expect(rows[1]?.querySelector("[data-report-row-flag]")).toBeNull();
    const over = rows[2]?.querySelector("[data-report-row-flag]");
    expect(over?.textContent).toBe("34% · acima da meta");
    expect(over?.querySelector("svg")).not.toBeNull();
    // Cost with no sales: flagged, and the figure reads a dash.
    expect(rows[3]?.querySelector("[data-report-row-flag]")?.textContent).toBe("— · acima da meta");
  });

  it("draws a table without a flag exactly as before", () => {
    const flagged = FLAGGED_TABLE as Extract<ReportRender, { kind: "table" }>;
    const plain: ReportRender = { kind: "table", columns: flagged.columns, rows: flagged.rows };
    render(<ReportRenderView render={plain} dataTestId="r" />);
    expect(screen.getByTestId("r-table").querySelector("[data-report-row-flag]")).toBeNull();
    expect(screen.getByText("34%")).toBeTruthy();
  });
});

describe("a heat map", () => {
  it("draws the ui HeatMap, named by the caption, whole percents in its cells", () => {
    render(<ReportRenderView render={HEATMAP} dataTestId="r" caption="Custo / vendas por hora" />);
    const table = screen.getByRole("table", { name: "Custo / vendas por hora" });
    expect(within(table).getByRole("cell", { name: "58% acima da meta" })).toBeTruthy();
    expect(screen.getByTestId("r-heatmap-cell-2-ter-10").getAttribute("data-tone")).toBe("empty");
    expect(screen.getByTestId("r-heatmap-cell-2-ter-11").getAttribute("data-tone")).toBe("blank");
  });

  it("exports the long form it was folded from", () => {
    const columns = exportColumnsFor(HEATMAP, PT_BR_REPORT_ENGINE_COPY.values);
    expect(columns.map((column) => column.header)).toEqual(["Dia da semana", "Hora", "Custo / vendas"]);
    expect(columns[2]?.value({ ratio: 0.584 })).toBe("58,4%");
  });
});

describe("notes", () => {
  const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `P${index + 1}`);

  it("lists up to three names, then 'e mais N'", () => {
    expect(noteText({ key: "n", text: "Sem custo/hora: {items}.", items: names(2) }, COPY)).toBe(
      "Sem custo/hora: P1; P2.",
    );
    expect(noteText({ key: "n", text: "Sem custo/hora: {items}.", items: names(5) }, COPY)).toBe(
      "Sem custo/hora: P1; P2; P3 e mais 2.",
    );
  });

  it("appends the list when the text has no placeholder, and leaves a plain note alone", () => {
    expect(noteText({ key: "n", text: "Fechados:", items: ["sáb, Marcos"] }, COPY)).toBe("Fechados: sáb, Marcos");
    expect(noteText({ key: "n", text: "Só texto." }, COPY)).toBe("Só texto.");
  });

  it("hides a note whose list is empty", () => {
    expect(isNoteShown({ key: "n", text: "{items}", items: [] })).toBe(false);
    expect(isNoteShown({ key: "n", text: "x" })).toBe(true);
  });

  it("splits block notes from KPI hints", () => {
    const notes: ReportNoteView[] = [
      { key: "hint", text: "meta 30% · 2 dias acima", figure: 3 },
      { key: "block", text: "1 turno fechado automaticamente" },
      { key: "empty", text: "{items}", items: [] },
    ];
    expect(blockNotes(notes).map((note) => note.key)).toEqual(["block"]);
    expect([...figureHints(notes, COPY)]).toEqual([[3, "meta 30% · 2 dias acima"]]);
  });

  it("draws a note's hint under its KPI figure", () => {
    const kpi: ReportRender = {
      kind: "kpi",
      label: "Horas",
      value: 10,
      suppressed: false,
      format: "integer",
      figures: [
        { label: "Horas", value: 10, suppressed: false, format: "integer" },
        { label: "Custo / vendas", value: 0.25, suppressed: false, format: "percent" },
      ],
      rows: [],
    };
    render(
      <ReportRenderView render={kpi} dataTestId="k" notes={[{ key: "h", text: "meta 30%", figure: 1 }]} />,
    );
    expect(screen.getByTestId("k-kpi-1").textContent).toContain("meta 30%");
    expect(screen.getByTestId("k-kpi").textContent).not.toContain("meta 30%");
  });

  it("draws block notes with their action as an outline button, and nothing when there are none", () => {
    const { unmount } = render(
      <MemoryRouter>
        <ReportNotes
          tenantSlug="acme"
          dataTestId="b"
          notes={[
            {
              key: "rate",
              text: "Sem custo/hora: {items}.",
              items: ["Pedro (Entregas), 12 h"],
              action: { label: "Definir custo", href: "config/shifts#shift-labor-cost" },
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("b-note-rate").textContent).toContain("Sem custo/hora: Pedro (Entregas), 12 h.");
    expect(screen.getByRole("button", { name: "Definir custo" })).toBeTruthy();
    unmount();

    render(
      <MemoryRouter>
        <ReportNotes tenantSlug="acme" dataTestId="b" notes={[{ key: "x", text: "{items}", items: [] }]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("b-notes")).toBeNull();
  });
});
