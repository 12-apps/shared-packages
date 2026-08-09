/**
 * The block's ✎ config surface (FUT-391): a right-hand PANEL on desktop, a
 * bottom SHEET on a narrow screen.
 *
 * It replaces a popover, for two reasons the popover could not fix:
 *
 * 1. **It covered the block it configured.** The preview re-runs live on every
 *    keystroke, which is worth nothing when the thing being previewed is
 *    behind the form. A panel sits beside the canvas, so the block stays
 *    visible while its spec changes.
 * 2. **It truncated its own controls.** At 360px wide the labels rendered as
 *    `St…` and `igu…` — a filter row the author cannot read is a filter row
 *    they cannot trust. Full height and a fixed 344px give every control its
 *    label.
 *
 * DOCKED AND NON-MODAL, and the two are the same requirement (FUT-755). Point 1
 * is only true if the canvas GIVES UP the panel's width: a modal drawer floats
 * over the canvas, so the block being configured ends up behind the form again,
 * with a backdrop swallowing the first click on the preview and a focus trap
 * keeping the keyboard out of it. So desktop renders a `persistent` drawer —
 * no backdrop, no scroll lock, no focus trap, nothing inert — and reserves its
 * width from the canvas through `useDockReservation`.
 *
 * A bottom sheet on a phone is the deliberate exception: there is no canvas
 * width to give up at 390px, so the sheet overlays. It keeps a MODAL drawer's
 * dismissal (a tap above the sheet closes it) but with an INVISIBLE backdrop,
 * so the block above stays legible rather than sitting behind a scrim.
 *
 * The settings drawer elsewhere in the app stays a plain modal drawer. That is
 * not an inconsistency: settings are a discrete task, block configuration is
 * continuous work alongside the thing being configured.
 *
 * The test ids are unchanged from the popover on purpose: `report-block-<id>-editor`
 * and `-editor-entity` are driven by future-pay's reports e2e, so swapping the
 * container must not break a consumer's suite.
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { Drawer, DrawerContent, DrawerHeader } from "@12-apps/ui/layout/Drawer";
import { Box } from "@12-apps/ui/mui/Box";
import useMediaQuery from "@12-apps/ui/mui/useMediaQuery";
import { Text } from "@12-apps/ui/typography/Text";

import { BlockQueryFields, fieldMapOf } from "./block-query-fields";
import { draftFromSpec, specFromDraft, withValidChart, type BuilderDraft } from "./builder-model";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";
import { useDockReservation } from "./lib/docked-panel";

/**
 * Below this the panel becomes a bottom sheet. It is the FORM's threshold, not
 * a page breakpoint: a 344px panel beside a canvas needs roughly this much
 * room before the canvas it is meant to keep visible stops being visible.
 */
const SHEET_BELOW_PX = 760;

/** Wide enough that a filter's three controls read in full (FUT-391). */
const PANEL_WIDTH_PX = 344;

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

/** Rounded top corners: the sheet reads as lifted off the canvas, not welded on. */
const SHEET_PAPER_SX = { borderTopLeftRadius: 16, borderTopRightRadius: 16 };

/**
 * A persistent drawer's docked root is a REAL element in the grid cell the
 * panel renders from. It has no height — its surface is `position: fixed` — but
 * at its natural 344px it overhangs the cell and can add a horizontal
 * scrollbar. Zero it: the panel's width is reserved from the canvas by
 * `useDockReservation`, never taken from the cell it happens to live in.
 */
const DOCKED_ROOT_SX = { "& .MuiDrawer-docked": { width: 0 } };

/**
 * Escape closes the docked panel.
 *
 * A modal drawer got this from MUI's `Modal`; a docked one renders no modal, so
 * nothing else is listening. The listener sits on `window` and skips a handled
 * event, so a nested dialog (the remove confirmation) still gets Escape first —
 * it stops the event before it reaches here.
 */
function useEscapeToClose(active: boolean, close: () => void): void {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}

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
function SheetGrip({ onDismiss }: { onDismiss: () => void }): JSX.Element {
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

interface BlockEditorPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * The control that opened the panel. Focus returns to it on close — without
   * that, focus falls to the document and a keyboard user closing the panel
   * restarts from the top of the page.
   */
  restoreFocusTo?: RefObject<HTMLElement | null>;
  entities: ReportEntityFields[];
  spec: ReportSpecWire;
  span: number;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}

export function BlockEditorPanel({
  open,
  onClose,
  restoreFocusTo,
  entities,
  spec,
  span,
  onChange,
  onSpanChange,
  testId,
}: BlockEditorPanelProps): JSX.Element {
  // Seeded once per opening (the caller remounts via `key`): the draft keeps
  // half-finished rows — a blank "+ Medida" line, a filter with no value yet —
  // that the serialized spec necessarily drops.
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFromSpec("", "", spec));
  const asSheet = useMediaQuery(`(max-width:${SHEET_BELOW_PX - 1}px)`);
  const docked = open && !asSheet;

  const close = (): void => {
    onClose();
    restoreFocusTo?.current?.focus();
  };

  // The canvas gives up exactly the panel's width, so nothing sits under it.
  useDockReservation(docked ? PANEL_WIDTH_PX : 0);
  useEscapeToClose(docked, close);

  const apply = (next: BuilderDraft): void => {
    const map = fieldMapOf(entities.find((candidate) => candidate.entity === next.entity));
    const valid = withValidChart(next, map);
    setDraft(valid);
    onChange(specFromDraft(valid, map));
  };

  return (
    <Box sx={asSheet ? undefined : DOCKED_ROOT_SX}>
      <Drawer
        open={open}
        onClose={close}
        anchor={asSheet ? "bottom" : "right"}
        width={asSheet ? "100%" : PANEL_WIDTH_PX}
        height={asSheet ? SHEET_HEIGHT : undefined}
        persistent={!asSheet}
        // Docked: no modal at all, so nothing to draw. Sheet: a backdrop that
        // catches the tap above it and closes, but paints nothing — the block
        // being edited has to stay readable above the sheet.
        backdrop={false}
        paperSx={asSheet ? SHEET_PAPER_SX : DOCKED_PAPER_SX}
        dataTestId={testId}
      >
        {asSheet ? <SheetGrip onDismiss={close} /> : null}
        <DrawerHeader onClose={close} dataTestId={`${testId}-header`}>
          <Text variant="heading" size="sm" as="h2">
            Bloco
          </Text>
        </DrawerHeader>
        <DrawerContent dataTestId={`${testId}-content`}>
          {/* Scrolls inside the panel: the header and its close control stay
              reachable however long the form gets. */}
          <Box sx={{ overflowY: "auto", pb: 2 }}>
            <BlockQueryFields
              draft={draft}
              entities={entities}
              span={span}
              apply={apply}
              onSpanChange={onSpanChange}
              testId={testId}
            />
          </Box>
        </DrawerContent>
      </Drawer>
    </Box>
  );
}
