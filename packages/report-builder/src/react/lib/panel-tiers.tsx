/**
 * The block config panel's three responsive tiers, as pure geometry (FUT-755).
 *
 * Extracted from `block-editor-panel.tsx` so that file can be about what the
 * panel SAYS and this one about where it sits — the panel gained a spec
 * sentence, a title field and a footer, and the size gate is a real ceiling.
 * `lib/docked-panel.tsx` decides WHICH tier is active and owns the thresholds;
 * this decides what each one looks like.
 *
 * The rule they all obey, and the one that keeps being lost: docked and overlay
 * are NON-MODAL — no backdrop, no scroll lock, no focus trap — because a panel
 * that covers the block it configures is the popover this replaced. Only the
 * sheet is a real modal drawer, and even then with an invisible backdrop.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from "react";

import { Box } from "@12-apps/ui/mui/Box";

import type { PanelTier } from "./docked-panel";
import { CONTAINER_RADIUS_PX } from "./report-surface";

/** Wide enough that a filter's three controls read in full (FUT-391). */
export const PANEL_WIDTH_PX = 344;

/** Leaves the canvas peeking above the sheet, so the edit still has context. */
const SHEET_HEIGHT = "78vh";

/** How far down the sheet must travel before releasing the grip dismisses it. */
const SHEET_DISMISS_FRACTION = 0.4;

/**
 * The docked panel's surface.
 *
 * `--report-panel-top` is the host's own header height: a host that renders a
 * fixed app bar sets it and the panel starts below the bar instead of under it.
 * Unset — the harness, a host with no fixed chrome — it resolves to 0 and the
 * panel is full height, which is what it was.
 */
const DOCKED_PAPER_SX = {
  top: "var(--report-panel-top, 0px)",
  height: "calc(100% - var(--report-panel-top, 0px))",
};

/**
 * The overlay tier's surface: the docked one plus the shadow that separates it
 * from the canvas it is now floating over. Written as an explicit CSS value
 * rather than a theme elevation because the elevation scale casts DOWNWARD and
 * this shadow has to fall leftward, onto the content the panel covers.
 */
const OVERLAY_PAPER_SX = {
  ...DOCKED_PAPER_SX,
  boxShadow: "-12px 0 32px -8px rgba(0, 0, 0, 0.32)",
};

/**
 * Rounded top corners: the sheet reads as lifted off the canvas, not welded on.
 * At the CONTAINER radius, because a sheet is a container and this was a third
 * value in a family `visual-pass.md` §Components caps at two.
 */
const SHEET_PAPER_SX = {
  borderTopLeftRadius: CONTAINER_RADIUS_PX,
  borderTopRightRadius: CONTAINER_RADIUS_PX,
};

/**
 * A persistent drawer's docked root is a REAL element in the flow of whatever
 * renders it. It has no height — its surface is `position: fixed` — but at its
 * natural 344px it overhangs and can add a horizontal scrollbar. Zero it: the
 * panel's width is reserved from the canvas by `useDockReservation`, never
 * taken from wherever the element happens to sit.
 */
const DOCKED_ROOT_SX = { "& .MuiDrawer-docked": { width: 0 } };

/**
 * Everything about a tier that is pure geometry, in one lookup.
 *
 * Deliberately not exported: callers read a tier out of {@link TIER_LAYOUT} and
 * get this shape by inference, so exporting the name would be an unused export
 * for the knip gate to flag.
 */
interface TierLayout {
  anchor: "right" | "bottom";
  width: number | string;
  height?: string;
  /** `false` is a real modal drawer — the sheet, and only the sheet. */
  persistent: boolean;
  paperSx: Record<string, number | string>;
  rootSx?: Record<string, Record<string, number>>;
}

export const TIER_LAYOUT: Record<PanelTier, TierLayout> = {
  docked: {
    anchor: "right",
    width: PANEL_WIDTH_PX,
    persistent: true,
    paperSx: DOCKED_PAPER_SX,
    rootSx: DOCKED_ROOT_SX,
  },
  overlay: {
    anchor: "right",
    width: PANEL_WIDTH_PX,
    persistent: true,
    paperSx: OVERLAY_PAPER_SX,
    rootSx: DOCKED_ROOT_SX,
  },
  sheet: {
    anchor: "bottom",
    width: "100%",
    height: SHEET_HEIGHT,
    persistent: false,
    paperSx: SHEET_PAPER_SX,
  },
};

/**
 * Drag the grip down to dismiss the sheet; release short of the threshold and
 * it springs back.
 *
 * The offset is written as an INLINE transform on MUI's paper because that is
 * where the slide transition writes too — an `sx` rule would lose to the
 * `transform: none` the transition leaves behind once the sheet is in.
 */
function sheetDragHandler(onDismiss: () => void) {
  return (event: ReactPointerEvent<HTMLElement>): void => {
    const paper = event.currentTarget.closest<HTMLElement>(".MuiDrawer-paper");
    if (paper === null) return;
    const startY = event.clientY;
    const threshold = paper.getBoundingClientRect().height * SHEET_DISMISS_FRACTION;
    const travelled = (moved: globalThis.PointerEvent): number => Math.max(0, moved.clientY - startY);

    const onMove = (moved: globalThis.PointerEvent): void => {
      paper.style.transform = `translateY(${travelled(moved)}px)`;
    };
    const onUp = (moved: globalThis.PointerEvent): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      paper.style.transform = "none";
      if (travelled(moved) > threshold) onDismiss();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
}

/**
 * The sheet's grab affordance. Decorative to assistive tech on purpose — the
 * header's close button is the announced, keyboard-reachable dismissal, and a
 * second control with the same meaning is noise in the tab order.
 */
export function SheetGrip({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  return (
    <Box
      aria-hidden="true"
      onPointerDown={sheetDragHandler(onDismiss)}
      sx={{
        display: "flex",
        justifyContent: "center",
        flex: "0 0 auto",
        py: 1,
        cursor: "grab",
        // Otherwise the browser claims the vertical drag for page scrolling.
        touchAction: "none",
      }}
    >
      <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: "divider" }} />
    </Box>
  );
}
