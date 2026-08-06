"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";

import { Slider } from "../../form/Slider";
import { Box } from "../../../mui/Box";

import { DATA_VIEWS_LAYOUTS, type DataViewsLayout } from "./data-views-types";

/**
 * The DataViews layout (view type): the dense "Tabela" grid, the "Grade" of
 * cards, the "Lista" of full-width rows, or the "Quadro" board of state columns.
 * Shared across the toolbar (the toggle) and the body (the selector) via context
 * so a single source of truth drives what renders — each layout only appears
 * when the table opts into it (`renderCard` for the grade, `renderListRow` for
 * the lista, `board` + `renderCard` for the quadro).
 */
export type { DataViewsLayout };

interface DataViewsLayoutValue {
  layout: DataViewsLayout;
  setLayout: (layout: DataViewsLayout) => void;
  /** How much air each record gets — see {@link DataViewsDensity}. */
  density: DataViewsDensity;
  setDensity: (density: DataViewsDensity) => void;
  /** Whether the cards layout is available (a `renderCard` was supplied). */
  canUseCards: boolean;
  /** Whether the list layout is available (a `renderListRow` was supplied). */
  canUseList: boolean;
  /** Whether the board layout is available (a `board` config AND a `renderCard`). */
  canUseBoard: boolean;
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
 * Where the user's layout preference is remembered. ONE key for every DataViews
 * table in the app, on purpose: picking "Grade" on Produtos is a statement about
 * how this operator likes to read lists, not about that one screen. Every other
 * screen that CAN render cards then opens in cards, and one that cannot falls
 * back without forgetting the preference.
 */
const LAYOUT_STORAGE_KEY = "dataviews:layout";

/**
 * The density preference, remembered app-wide for the same reason as the layout:
 * an operator who wants tight rows wants them on every list, not on one.
 */
const DENSITY_STORAGE_KEY = "dataviews:density";

/**
 * How much room each record gets. It means different things per layout, and
 * that is the point — one control, phrased in the terms of what is on screen:
 *
 * - table / list → row height ("Baixa / Média / Alta")
 * - cards        → how many fit per row ("Muitos / Médio / Poucos")
 *
 * The board is unaffected: its cards are already sized by the zoom slider.
 */
export type DataViewsDensity = "compact" | "cozy" | "comfortable";

/** Every density this build knows — the guard's single source. */
const DENSITIES: readonly DataViewsDensity[] = ["compact", "cozy", "comfortable"];

/** Vertical padding (theme spacing units) per density, for a table or list row. */
export const DENSITY_ROW_PADDING: Record<DataViewsDensity, number> = {
  compact: 0.25,
  cozy: 0.75,
  comfortable: 1.5,
};

/** Card grid columns per density — how many cards land on one row. */
export const DENSITY_CARD_COLUMNS: Record<DataViewsDensity, number> = {
  compact: 5,
  cozy: 4,
  comfortable: 3,
};

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

/** Which layouts this table can actually render. */
interface LayoutAvailability {
  canUseCards: boolean;
  canUseList: boolean;
  canUseBoard: boolean;
}

/** Is this a layout string this build knows? Guards whatever is in storage. */
function isLayout(value: unknown): value is DataViewsLayout {
  return DATA_VIEWS_LAYOUTS.includes(value as DataViewsLayout);
}

/** Is this a density this build knows? Guards whatever is in storage. */
function isDensity(value: unknown): value is DataViewsDensity {
  return DENSITIES.includes(value as DataViewsDensity);
}

/** The remembered density, or undefined (no window, no value, junk). */
function readStoredDensity(): DataViewsDensity | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return isDensity(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pin a layout to one this table can render. "Tabela" is always available, so it
 * is the floor: a page with no `renderCard` never renders a cards body, one with
 * no `renderListRow` never renders a list, and one with no `board` config never
 * renders a board — whatever is stored, saved in a view, or requested.
 */
function pinLayout(layout: DataViewsLayout, available: LayoutAvailability): DataViewsLayout {
  if (layout === "cards") return available.canUseCards ? "cards" : "table";
  if (layout === "list") return available.canUseList ? "list" : "table";
  if (layout === "board") return available.canUseBoard ? "board" : "table";
  return "table";
}

/** The stored cross-screen preference, or undefined (no window, no value, junk). */
function readStoredLayout(): DataViewsLayout | undefined {
  // Guarded rather than assumed: this module is also imported in Node (tests,
  // any SSR host), and a `localStorage` access can throw outright under a
  // restrictive privacy setting — a thrown read must not take the grid with it.
  try {
    if (typeof window === "undefined") return undefined;
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return isLayout(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Remember a preference for every other screen. A failed write is not an error. */
function writeStored(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota / disabled storage: the preference simply does not
    // survive the session. Nothing about the current view depends on it.
  }
}

interface LayoutProviderProps extends Partial<LayoutAvailability> {
  /** Which layout to show first when the user has expressed no preference. */
  defaultLayout?: DataViewsLayout;
  /**
   * The layout an APPLIED SAVED VIEW pins, when it stored one. It wins over the
   * remembered preference for as long as that view is applied — the view is a
   * snapshot someone chose to keep — but it does NOT overwrite the preference:
   * only the toggle does that, because only the toggle is the user saying so.
   */
  viewLayout?: DataViewsLayout;
  /**
   * Ignore — and stop writing — the remembered cross-screen preference, making
   * `defaultLayout` authoritative for this table.
   *
   * For a table that exists to SHOW a particular layout rather than to be
   * browsed: a Storybook story called "Board", a docs example, a screenshot
   * harness. Without it the remembered preference wins, so opening "Board"
   * after having clicked Tabela anywhere renders a table — the demonstration
   * silently showing the wrong thing, and a shared link doing it for everyone
   * whose preference differs.
   *
   * A real screen leaves this off: remembering how someone likes to read
   * lists is the point.
   */
  ignoreStoredLayout?: boolean;
  children: ReactNode;
}

/**
 * Provides the view-type state, seeded from (in order) the applied saved view's
 * layout, the user's remembered cross-screen preference, then `defaultLayout` —
 * each pinned to what this table can actually render.
 */
export function DataViewsLayoutProvider({
  canUseCards = false,
  canUseList = false,
  canUseBoard = false,
  defaultLayout = "table",
  viewLayout,
  ignoreStoredLayout = false,
  children,
}: LayoutProviderProps): React.JSX.Element {
  const availability = { canUseCards, canUseList, canUseBoard };
  const [layout, setLayoutState] = useState<DataViewsLayout>(() =>
    pinLayout(
      viewLayout ?? (ignoreStoredLayout ? undefined : readStoredLayout()) ?? defaultLayout,
      availability,
    ),
  );
  const [density, setDensityState] = useState<DataViewsDensity>(
    () => (ignoreStoredLayout ? undefined : readStoredDensity()) ?? "cozy",
  );
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  // A newly applied view carrying a layout switches to it (its reference-change
  // is the signal, exactly as `appliedState` works for the filters).
  useEffect(() => {
    if (viewLayout) setLayoutState(pinLayout(viewLayout, availability));
    // Availability is derived from props that do not change for a mounted table.
  }, [viewLayout]);
  // Pin again on read: `canUseCards`/`canUseBoard` can flip for a mounted table
  // (a page that supplies `renderCard` only once its card data has loaded), and
  // a stale "cards" would otherwise render a cards body with no renderer.
  const effective = pinLayout(layout, availability);

  const value = useMemo<DataViewsLayoutValue>(
    () => ({
      layout: effective,
      setLayout: (next: DataViewsLayout) => {
        const pinned = pinLayout(next, availability);
        setLayoutState(pinned);
        // Remember the user's own choice across every screen — see LAYOUT_STORAGE_KEY.
        // A table pinned to a layout does not write: it would teach the
        // preference a value the operator never chose.
        if (!ignoreStoredLayout) writeStored(LAYOUT_STORAGE_KEY, pinned);
      },
      density,
      setDensity: (next: DataViewsDensity) => {
        setDensityState(next);
        if (!ignoreStoredLayout) writeStored(DENSITY_STORAGE_KEY, next);
      },
      canUseCards,
      canUseList,
      canUseBoard,
      zoom,
      setZoom,
    }),
    [effective, density, canUseCards, canUseList, canUseBoard, zoom],
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

/**
 * Card-size slider for the toolbar — shown in the CARD-BASED layouts ("Grade"
 * and "Quadro"), mirroring the tabwoah view-selector's zoom. The board reuses
 * the same `renderCard`, so the same knob scales both.
 *
 * Deliberately ABSENT in "Lista" and "Tabela" (FUT-733): a list row is
 * full-width and sized by its content, so a card-size multiplier has nothing to
 * act on — a slider that moved and changed nothing would be worse than none.
 */
export function DataViewsZoomSlider({ testIdPrefix }: { testIdPrefix: string }): React.JSX.Element | null {
  const { layout, zoom, setZoom } = useDataViewsLayout();
  if (layout !== "cards" && layout !== "board") return null;
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
