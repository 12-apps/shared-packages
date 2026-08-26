"use client";

import type { DataViewsCopy } from "./data-views-copy";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import useMediaQuery from "@mui/material/useMediaQuery/index.js";
import type { Theme } from "@mui/material/styles/index.js";

import { useDataViewsCopy } from "./data-views-copy-context";
import type { SortFieldDefinition } from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import {
  BoardGlyph,
  ColumnsGlyph,
  GridGlyph,
  ListGlyph,
  RowsGlyph,
  TableGlyph,
} from "./data-views-glyphs";
import {
  useDataViewsLayout,
  type DataViewsDensity,
  type DataViewsLayout,
} from "./data-views-layout-context";

/**
 * Two of the three tabs inside the "Exibir" panel — Ordenar and Exibição. The
 * Colunas tab is its own file (`data-views-columns-tab.tsx`) for the size budget.
 *
 * They live together because they answer one question ("how do I want to read
 * this list?") and were previously three separate toolbar dropdowns that the
 * operator had to know apart. Split into this file so the panel that frames
 * them, and each tab, stays inside the size budget.
 */

/* ── Shared tile ─────────────────────────────────────────────────────────── */

/** A picker tile: a glyph over its label, highlighted when it is the choice. */
function Tile({
  active,
  label,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.75,
        p: 1.25,
        border: 1,
        borderStyle: "solid",
        borderColor: active ? "primary.main" : "divider",
        bgcolor: active ? "action.selected" : "transparent",
        borderRadius: 1,
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.75rem",
        fontWeight: active ? 600 : 400,
        color: active ? "primary.main" : "text.secondary",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {children}
      {label}
    </Box>
  );
}

/* ── Ordenar ─────────────────────────────────────────────────────────────── */

/**
 * Direction labels read in the COLUMN'S OWN TERMS. "Crescente" on a currency
 * column is a puzzle the operator has to solve every time; "Menor → maior" is
 * not, and "Mais recente" is what someone actually means about a date.
 */
const DIRECTION_LABELS: Record<string, [string, string]> = {
  number: ["Menor → maior", "Maior → menor"],
  currency: ["Menor → maior", "Maior → menor"],
  date: ["Mais antigo", "Mais recente"],
  text: ["A → Z", "Z → A"],
};

/** The direction wording for a sort field, falling back to alphabetical. */
function directionLabels(kind: string | undefined): [string, string] {
  return DIRECTION_LABELS[kind ?? "text"] ?? DIRECTION_LABELS.text!;
}

interface SortTabProps {
  fields: SortFieldDefinition[];
  activeField: string;
  activeOrder: "asc" | "desc";
  onChange: (field: string, order: "asc" | "desc") => void;
  /** Per-field value kind, so the direction can be phrased in its own terms. */
  sortKinds?: Record<string, string>;
  testIdPrefix: string;
}

/** Direction first (two tiles), then the field list — the order they are decided in. */
export function SortTab({
  fields,
  activeField,
  activeOrder,
  onChange,
  sortKinds,
  testIdPrefix,
}: SortTabProps): React.JSX.Element {
  const copy = useDataViewsCopy();
  const [ascLabel, descLabel] = directionLabels(sortKinds?.[activeField]);
  return (
    <Box sx={{ p: 1 }}>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          {copy.display.direction}
        </Box>
      </Text>
      <Box sx={{ display: "flex", gap: 0.75, mb: 1.5, mt: 0.5 }}>
        {(["asc", "desc"] as const).map((direction, index) => (
          <Tile
            key={direction}
            active={activeOrder === direction}
            label={index === 0 ? ascLabel : descLabel}
            onClick={() => onChange(activeField || fields[0]?.value || "", direction)}
            testId={`${testIdPrefix}-sort-dir-${direction}`}
          >
            {direction === "asc" ? (
              <ArrowUpwardRoundedIcon fontSize="small" />
            ) : (
              <ArrowDownwardRoundedIcon fontSize="small" />
            )}
          </Tile>
        ))}
      </Box>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          {copy.display.fieldHeading}
        </Box>
      </Text>
      {fields.map((field) => (
        <SortFieldRow
          key={field.value}
          label={field.label}
          active={field.value === activeField}
          onClick={() => onChange(field.value, activeOrder)}
          testId={`${testIdPrefix}-sort-field-${field.value}`}
        />
      ))}
    </Box>
  );
}

/** One sort field: a dot and its label, highlighted when it is the active sort. */
function SortFieldRow({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      data-testid={testId}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        px: 1,
        py: 0.75,
        border: 0,
        background: "none",
        borderRadius: 1,
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.8125rem",
        textAlign: "left",
        fontWeight: active ? 600 : 400,
        color: active ? "primary.main" : "text.primary",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        component="span"
        sx={{ height: 6, width: 6, borderRadius: "50%", bgcolor: active ? "primary.main" : "action.disabled" }}
      />
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        {label}
      </Box>
    </Box>
  );
}

/* ── Exibição ────────────────────────────────────────────────────────────── */


/**
 * What density MEANS in each layout — same three values, three different
 * questions. A table's is how tall its rows are, a card grid's is how many fit
 * on a line, and a board's is how wide its columns are. The heading and the
 * tile labels change with the layout because "Alta" over a board is meaningless
 * where "Larga" is not.
 */


/** The density tiles, phrased for whichever layout is on screen. */
function densityTiles(
  layout: DataViewsLayout,
  copy: DataViewsCopy,
): { value: DataViewsDensity; label: string; gap: number; columns: number }[] {
  // A layout the pack does not key falls back to the table's words rather
  // than rendering three blank tiles — a host adding a layout should still see
  // a usable control while it writes the labels for it.
  const labels = copy.display.densityLabels[layout] ?? copy.display.densityLabels.table;
  return [
    { value: "compact", label: labels?.compact ?? "compact", gap: 2, columns: 4 },
    { value: "cozy", label: labels?.cozy ?? "cozy", gap: 5, columns: 3 },
    { value: "comfortable", label: labels?.comfortable ?? "comfortable", gap: 8, columns: 2 },
  ];
}

/** The preview for one density tile, in the terms that layout's density is in. */
function densityGlyph(
  layout: DataViewsLayout,
  tile: { gap: number; columns: number },
  active: boolean,
): React.JSX.Element {
  if (layout === "cards") return <GridGlyph n={tile.columns} active={active} />;
  // A wider column means FEWER of them across the same board, so the
  // comfortable end draws two fat columns and the compact end four thin ones.
  if (layout === "board") return <ColumnsGlyph n={tile.columns} active={active} />;
  return <RowsGlyph gap={tile.gap} active={active} />;
}

/** The glyph for a layout tile. */
function layoutGlyph(layout: DataViewsLayout, active: boolean): React.JSX.Element {
  if (layout === "table") return <TableGlyph active={active} />;
  if (layout === "list") return <ListGlyph active={active} />;
  if (layout === "cards") return <GridGlyph active={active} />;
  return <BoardGlyph active={active} />;
}

const LAYOUT_TILE_LABELS: Record<DataViewsLayout, string> = {
  table: "Tabela",
  list: "Lista",
  cards: "Grade",
  board: "Quadro",
};

/**
 * Format and density, both shown as PREVIEWS rather than words — see
 * `data-views-glyphs.tsx` for why. A layout this table cannot render is simply
 * not offered, and the panel says why rather than leaving a gap.
 */
/**
 * The three density tiles — or, on a phone, a line saying why there are none:
 * the card grid is `1fr` there, so all three would draw one card per row. Says
 * so rather than vanishing, for the same reason as the board note below it.
 */
function DensityTiles({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { layout, density, setDensity } = useDataViewsLayout();
  // Matches the card grid's own `xs: "1fr"` track, so the control and the thing
  // it controls agree on where density stops meaning anything.
  const isOneColumn = useMediaQuery((t: Theme) => t.breakpoints.down("sm"));
  if (layout === "cards" && isOneColumn) {
    return (
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, pt: 0.5, display: "block", color: "text.disabled" }}>
          {copy.display.densityUnavailableNarrow}
        </Box>
      </Text>
    );
  }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mt: 0.5 }}>
      {densityTiles(layout, copy).map((tile) => (
        <Tile
          key={tile.value}
          active={density === tile.value}
          label={tile.label}
          onClick={() => setDensity(tile.value)}
          testId={`${testIdPrefix}-density-${tile.value}`}
        >
          {densityGlyph(layout, tile, density === tile.value)}
        </Tile>
      ))}
    </Box>
  );
}

export function DisplayTab({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { layout, setLayout, canUseCards, canUseList, canUseBoard } = useDataViewsLayout();
  const available: DataViewsLayout[] = [
    "table",
    ...(canUseList ? (["list"] as const) : []),
    ...(canUseCards ? (["cards"] as const) : []),
    ...(canUseBoard ? (["board"] as const) : []),
  ];
  return (
    <Box sx={{ p: 1 }}>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          {copy.display.formatHeading}
        </Box>
      </Text>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: available.length > 3 ? "repeat(2, 1fr)" : `repeat(${available.length}, 1fr)`,
          gap: 0.75,
          mt: 0.5,
        }}
      >
        {available.map((value) => (
          <Tile
            key={value}
            active={layout === value}
            label={LAYOUT_TILE_LABELS[value]}
            onClick={() => setLayout(value)}
            testId={`${testIdPrefix}-layout-${value}`}
          >
            {layoutGlyph(value, layout === value)}
          </Tile>
        ))}
      </Box>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, py: 1, display: "block", color: "text.disabled" }}>
          {copy.display.layoutHints[layout]}
        </Box>
      </Text>
      {/* Every layout gets this, the board included. It used to be hidden on
          Quadro, which left the format tile switching to a view with no sizing
          control at all — and the section disappearing on select reads as a
          control that broke rather than one that does not apply. */}
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          {copy.display.densityHeadings[layout]}
        </Box>
      </Text>
      <DensityTiles testIdPrefix={testIdPrefix} />
      {!canUseBoard && (
        <Text variant="caption" as="p">
          <Box component="span" sx={{ px: 0.5, pt: 1.25, display: "block", color: "text.disabled" }}>
            {copy.display.boardUnavailable}
          </Box>
        </Text>
      )}
    </Box>
  );
}
