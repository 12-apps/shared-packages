/**
 * The VIEWER's two block tools (FUT-755) — "ver como tabela" and "baixar CSV".
 *
 * Both used to be text. The CSV was a `CSV` button parked permanently in the
 * header, and the table toggle was a "Ver como tabela" link INSIDE the block
 * body, above the chart — so a canvas of six blocks carried twelve controls
 * competing with the figures they belong to, and one of them pushed the
 * rendering down by a whole control's height. `prototype.html` renders them as
 * one cluster of two glyphs that appears when the block is hovered
 * (`.block-tools`, revealed by `.block:hover`), which is what this is.
 *
 * The ROW behaviour — pinned top-right, never wrapping, overflowing into ⋮ —
 * belongs to `tool-cluster`, which the editor's chrome uses too. This file is
 * only what the viewer's two tools ARE.
 *
 * The toggle's STATE does not live here either. It cannot: the cluster sits in
 * the frame's header and the rendering it switches is the frame's child, so
 * the two are siblings and their common parent has to own it — {@link
 * useBlockTableView} is that ownership, in one place, for every consumer.
 * `ReportRenderView` therefore takes a plain `asTable` boolean and holds no
 * state of its own: one code path, not a controlled/uncontrolled pair.
 */
import { useCallback, useState, type JSX } from "react";

import { exportColumnsFor } from "../report-render";
import type { ReportRender } from "../reports-api";
import { exportRows } from "./export-rows";
import { Glyph } from "./glyph";
import { OverflowToolCluster, type BlockTool } from "./tool-cluster";

/** Grid — "show me the numbers this was drawn from". */
function TableGlyph(): JSX.Element {
  return (
    <Glyph>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16M10 10v9" />
    </Glyph>
  );
}

/** Bars — "put the drawing back". */
function ChartGlyph(): JSX.Element {
  return (
    <Glyph>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 19v-6M12.5 19v-9M17 19v-4" />
    </Glyph>
  );
}

/** Arrow into a tray — the download convention, and the prototype's CSV glyph. */
function DownloadGlyph(): JSX.Element {
  return (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </Glyph>
  );
}

/** What {@link useBlockTableView} hands back; passed straight to the cluster. */
interface BlockTableView {
  /** The rendering the tools act on — absent while a block loads or fails. */
  render: ReportRender | undefined;
  /** Whether the caller should render its chart AS its table right now. */
  asTable: boolean;
  /** Whether this rendering HAS a table view: charts with rows, nothing else. */
  canToggle: boolean;
  toggle: () => void;
}

/**
 * Who is looking at this block as a table — one block, right now.
 *
 * Deliberately NOT persisted (FUT-391): it is how someone wants to read this
 * block at this moment, not a property of the report. Saving it would change
 * what every other viewer sees. That is also why it is `useState` in the block
 * rather than anything the editor writes into the spec.
 *
 * `asTable` is gated on `canToggle` so a block whose rendering changed under it
 * — a period switch that turns a chart into an empty state, a re-run that comes
 * back as a KPI — cannot be left displaying a table view that no longer exists.
 */
export function useBlockTableView(render: ReportRender | undefined): BlockTableView {
  const [asTable, setAsTable] = useState(false);
  const toggle = useCallback(() => {
    setAsTable((current) => !current);
  }, []);
  const canToggle = render?.kind === "chart" && render.rows.length > 0;
  return { render, asTable: asTable && canToggle, canToggle, toggle };
}

/**
 * The viewer's cluster: the table toggle, then the CSV.
 *
 * RANKED in that order, which is what decides who keeps a visible slot when
 * the block is too narrow for both. The toggle is a chart's real accessibility
 * fallback — for a keyboard or screen-reader user it is the only way to read
 * the values at all — while a CSV is a deliberate, occasional export that a
 * menu row serves perfectly well.
 *
 * The CSV is built here rather than at each call site because it is the same
 * three lines everywhere: the rows on screen, `exportColumnsFor` over the SAME
 * render, and a file name. Deriving the columns anywhere else is how a
 * download starts disagreeing with the screen.
 */
export function BlockToolCluster({
  view,
  renderTestId,
  menuTestId,
  csv,
}: {
  view: BlockTableView;
  /**
   * The test id of the RENDERING these tools drive — the toggle is
   * `${renderTestId}-as-table`, which is the id it has always had and which
   * future-pay's reports e2e drives.
   */
  renderTestId: string;
  menuTestId: string;
  /** Omitted where the page exports from its own toolbar instead. */
  csv?: { filename: string; dataTestId: string };
}): JSX.Element | null {
  const { render } = view;
  const tools: BlockTool[] = [];
  if (view.canToggle) {
    tools.push({
      id: "as-table",
      label: view.asTable ? "Ver como gráfico" : "Ver como tabela",
      icon: view.asTable ? <ChartGlyph /> : <TableGlyph />,
      pressed: view.asTable,
      onSelect: view.toggle,
      dataTestId: `${renderTestId}-as-table`,
    });
  }
  if (csv !== undefined && render !== undefined) {
    tools.push({
      id: "export-csv",
      label: "Baixar CSV",
      icon: <DownloadGlyph />,
      onSelect: () => {
        exportRows("csv", render.rows, exportColumnsFor(render), csv.filename);
      },
      dataTestId: csv.dataTestId,
    });
  }

  return (
    <OverflowToolCluster
      tools={tools}
      menuTestId={menuTestId}
      menuLabel="Mais ações do bloco"
      reveal
    />
  );
}
