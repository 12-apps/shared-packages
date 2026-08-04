"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import ViewListOutlinedIcon from "@mui/icons-material/ViewListOutlined";

import { Button } from "../../form/Button";
import { Slider } from "../../form/Slider";
import { Box } from "../../../mui/Box";
import { DropdownMenu } from "../../navigation/DropdownMenu";

/**
 * The DataViews layout (view type): the dense "Tabela" grid, or the "Grade" of
 * cards. Shared across the toolbar (the toggle) and the body (the selector) via
 * context so a single source of truth drives what renders — the toggle only
 * appears when the table opts into cards by supplying a `renderCard` (each entity
 * implements its own card). Reusable feature of the DataViews machinery.
 */
export type DataViewsLayout = "cards" | "table";

interface DataViewsLayoutValue {
  layout: DataViewsLayout;
  setLayout: (layout: DataViewsLayout) => void;
  /** Whether the cards layout is available (a `renderCard` was supplied). */
  canUseCards: boolean;
  /** Card-size zoom (0–100); drives the card grid's min column width. */
  zoom: number;
  setZoom: (zoom: number) => void;
}

const DataViewsLayoutContext = createContext<DataViewsLayoutValue | null>(null);

/** Default card zoom (0–100). */
const DEFAULT_ZOOM = 35;
/** The card's width in px at scale 1 — the zoom slider multiplies this. */
const BASE_CARD_WIDTH = 180;
/** The size multiplier the zoom slider spans (0.75× to 2×). */
const CARD_SCALE_RANGE = { min: 0.75, max: 2 } as const;

/**
 * Map the 0–100 zoom to the card SIZE multiplier. This is the single knob: the
 * card's width is {@link BASE_CARD_WIDTH} × scale and its padding + typography
 * scale by the same factor, so the whole card grows together (scale 2 → twice
 * the size, proportion preserved by the aspect ratio). Passed to a card via
 * `DataViewCardSelection.scale`.
 */
export function cardScaleForZoom(zoom: number): number {
  const clamped = Math.max(0, Math.min(100, zoom));
  return CARD_SCALE_RANGE.min + (clamped / 100) * (CARD_SCALE_RANGE.max - CARD_SCALE_RANGE.min);
}

/** The card grid's min column width in px = base width × the zoom size multiplier. */
export function cardMinWidthForZoom(zoom: number): number {
  return Math.round(BASE_CARD_WIDTH * cardScaleForZoom(zoom));
}

/**
 * Provides the view-type state. When cards aren't available the layout is pinned
 * to "table" regardless, so a consumer never renders a cards body without a
 * `renderCard`.
 */
export function DataViewsLayoutProvider({
  canUseCards,
  defaultLayout = "table",
  children,
}: {
  canUseCards: boolean;
  defaultLayout?: DataViewsLayout;
  children: ReactNode;
}): React.JSX.Element {
  const [layout, setLayout] = useState<DataViewsLayout>(canUseCards ? defaultLayout : "table");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const value = useMemo<DataViewsLayoutValue>(
    () => ({ layout: canUseCards ? layout : "table", setLayout, canUseCards, zoom, setZoom }),
    [layout, canUseCards, zoom],
  );
  return <DataViewsLayoutContext.Provider value={value}>{children}</DataViewsLayoutContext.Provider>;
}

/** Read the current DataViews layout. Throws outside a provider. */
export function useDataViewsLayout(): DataViewsLayoutValue {
  const ctx = useContext(DataViewsLayoutContext);
  if (!ctx) {
    throw new Error("useDataViewsLayout must be used within a DataViewsLayoutProvider");
  }
  return ctx;
}

/** The layout options, in menu order. */
const GRADE_OPTION = { value: "cards" as const, label: "Grade", Icon: GridViewOutlinedIcon };
const TABELA_OPTION = { value: "table" as const, label: "Tabela", Icon: ViewListOutlinedIcon };
const LAYOUT_OPTIONS = [GRADE_OPTION, TABELA_OPTION];

/**
 * The layout selector for the toolbar — a muted dropdown icon-button showing the
 * active view's icon + a chevron, opening a menu of Grade/Tabela with a check on
 * the active one. Mirrors the other toolbar dropdowns (Columns / Sort By) rather
 * than a pair of buttons. Renders nothing when the table has no cards layout, so
 * pages without a `renderCard` are unaffected.
 */
export function DataViewsLayoutToggle({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element | null {
  const { layout, setLayout, canUseCards } = useDataViewsLayout();
  if (!canUseCards) return null;

  const active = layout === "cards" ? GRADE_OPTION : TABELA_OPTION;
  const ActiveIcon = active.Icon;

  return (
    <DropdownMenu
      size="sm"
      items={LAYOUT_OPTIONS.map((option) => ({
        id: option.value,
        // A check on the active option; the icon stays leading. `color` highlights
        // the active row. NOTE: DropdownMenu drops onClick for items with a custom
        // `component`, so keep to label/icon/onClick here.
        label: option.value === layout ? `${option.label}  ✓` : option.label,
        icon: <option.Icon fontSize="small" />,
        color: option.value === layout ? ("primary" as const) : undefined,
        onClick: () => setLayout(option.value),
      }))}
      trigger={
        <Button
          variant="text"
          size="sm"
          color="secondary"
          aria-label={`Exibição: ${active.label}`}
          dataTestId={`${testIdPrefix}-layout-toggle`}
        >
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
            <ActiveIcon fontSize="small" />
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </Box>
        </Button>
      }
    />
  );
}

/**
 * Card-size slider for the toolbar — shown ONLY in the cards ("Grade") layout,
 * mirroring the tabwoah view-selector's zoom. Adjusts the card grid's min column
 * width so the shopper can pack more/larger cards. Renders nothing in the table
 * layout or when cards aren't available.
 */
export function DataViewsZoomSlider({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element | null {
  const { layout, canUseCards, zoom, setZoom } = useDataViewsLayout();
  if (!canUseCards || layout !== "cards") return null;
  return (
    <Box
      sx={{
        display: { xs: "none", sm: "flex" },
        alignItems: "center",
        gap: 1,
        color: "text.secondary",
      }}
    >
      <GridViewOutlinedIcon sx={{ fontSize: 14 }} />
      <Box sx={{ width: 88, display: "flex", alignItems: "center" }}>
        <Slider
          size="sm"
          showValue={false}
          value={zoom}
          min={0}
          max={100}
          step={5}
          onChange={(_event, next) => setZoom(Array.isArray(next) ? (next[0] ?? 0) : next)}
          aria-label="Tamanho dos cards"
          data-testid={`${testIdPrefix}-card-zoom`}
        />
      </Box>
      <GridViewOutlinedIcon sx={{ fontSize: 20 }} />
    </Box>
  );
}
