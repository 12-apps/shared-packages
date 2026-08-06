"use client";

import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";

import type { SortFieldDefinition } from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import {
  BoardGlyph,
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
  const [ascLabel, descLabel] = directionLabels(sortKinds?.[activeField]);
  return (
    <Box sx={{ p: 1 }}>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          Direção
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
          Campo
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

/** One line of copy per layout, saying what it is FOR rather than what it is. */
const LAYOUT_HINTS: Record<DataViewsLayout, string> = {
  table: "Colunas comparáveis, boa para varrer números.",
  list: "Uma linha por item, com os dados principais.",
  cards: "Blocos maiores, bom para poucos itens.",
  board: "Colunas por etapa, para acompanhar o que está onde.",
};

/** The density tiles, phrased for whichever layout is on screen. */
function densityTiles(cards: boolean): { value: DataViewsDensity; label: string; gap: number; columns: number }[] {
  return [
    { value: "compact", label: cards ? "Muitos" : "Baixa", gap: 2, columns: 4 },
    { value: "cozy", label: cards ? "Médio" : "Média", gap: 5, columns: 3 },
    { value: "comfortable", label: cards ? "Poucos" : "Alta", gap: 8, columns: 2 },
  ];
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
export function DisplayTab({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element {
  const { layout, setLayout, canUseCards, canUseList, canUseBoard, density, setDensity } =
    useDataViewsLayout();
  const available: DataViewsLayout[] = [
    "table",
    ...(canUseList ? (["list"] as const) : []),
    ...(canUseCards ? (["cards"] as const) : []),
    ...(canUseBoard ? (["board"] as const) : []),
  ];
  const cards = layout === "cards";
  return (
    <Box sx={{ p: 1 }}>
      <Text variant="caption" as="p">
        <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
          Formato
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
          {LAYOUT_HINTS[layout]}
        </Box>
      </Text>
      {layout !== "board" && (
        <>
          <Text variant="caption" as="p">
            <Box component="span" sx={{ px: 0.5, color: "text.secondary" }}>
              {cards ? "Cards por linha" : "Altura das linhas"}
            </Box>
          </Text>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mt: 0.5 }}>
            {densityTiles(cards).map((tile) => (
              <Tile
                key={tile.value}
                active={density === tile.value}
                label={tile.label}
                onClick={() => setDensity(tile.value)}
                testId={`${testIdPrefix}-density-${tile.value}`}
              >
                {cards ? (
                  <GridGlyph n={tile.columns} active={density === tile.value} />
                ) : (
                  <RowsGlyph gap={tile.gap} active={density === tile.value} />
                )}
              </Tile>
            ))}
          </Box>
        </>
      )}
      {!canUseBoard && (
        <Text variant="caption" as="p">
          <Box component="span" sx={{ px: 0.5, pt: 1.25, display: "block", color: "text.disabled" }}>
            Esta tela não declara etapas, então não oferece quadro.
          </Box>
        </Text>
      )}
    </Box>
  );
}
