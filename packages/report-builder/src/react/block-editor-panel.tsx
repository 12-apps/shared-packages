/**
 * The block config surface (FUT-391): a right-hand PANEL on desktop, an
 * OVERLAY of the same panel on a tablet, a bottom SHEET on a phone.
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
 * The two narrow tiers give up the REFLOW, never the non-modality
 * (`lib/docked-panel.tsx` explains where each threshold comes from):
 *
 *   - **overlay** (760–1099px): the identical persistent drawer, reserving
 *     nothing, floating over the canvas with a shadow. Still no backdrop, so a
 *     click on the visible part of the canvas retargets the panel rather than
 *     being eaten.
 *   - **sheet** (below 760px): anchored to the bottom edge. It keeps a MODAL
 *     drawer's dismissal — a tap above the sheet closes it — but with an
 *     INVISIBLE backdrop, so the block being edited stays legible above it
 *     rather than sitting behind a scrim.
 *
 * The panel does not own WHICH block it edits: the canvas does (FUT-755). Pass
 * `spec: null` and it renders its empty state and stays docked, which is what
 * clicking the canvas background, pressing Escape and removing the selected
 * block all produce.
 *
 * The settings drawer elsewhere in the app stays a plain modal drawer. That is
 * not an inconsistency: settings are a discrete task, block configuration is
 * continuous work alongside the thing being configured.
 *
 * The test ids are unchanged from the popover on purpose: `report-block-<id>-editor`
 * and `-editor-entity` are driven by future-pay's reports e2e, so swapping the
 * container must not break a consumer's suite.
 */
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";

import { Drawer, DrawerContent, DrawerHeader } from "@12-apps/ui/layout/Drawer";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { BlockQueryFields, fieldMapOf } from "./block-query-fields";
import { draftFromSpec, specFromDraft, withValidChart, type BuilderDraft } from "./builder-model";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";
import {
  useDockReservation,
  useEscapeToClose,
  usePanelTier,
  type PanelTier,
} from "./lib/docked-panel";

/** Wide enough that a filter's three controls read in full (FUT-391). */
const PANEL_WIDTH_PX = 344;

/** Leaves the canvas peeking above the sheet, so the edit still has context. */
const SHEET_HEIGHT = "78vh";

/** How far down the sheet must travel before releasing the grip dismisses it. */
const SHEET_DISMISS_FRACTION = 0.4;

/** What the panel says when nothing is selected — the spec's exact wording. */
const EMPTY_TEXT = "Selecione um bloco para editar";

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

/** Rounded top corners: the sheet reads as lifted off the canvas, not welded on. */
const SHEET_PAPER_SX = { borderTopLeftRadius: 16, borderTopRightRadius: 16 };

/**
 * A persistent drawer's docked root is a REAL element in the flow of whatever
 * renders it. It has no height — its surface is `position: fixed` — but at its
 * natural 344px it overhangs and can add a horizontal scrollbar. Zero it: the
 * panel's width is reserved from the canvas by `useDockReservation`, never
 * taken from wherever the element happens to sit.
 */
const DOCKED_ROOT_SX = { "& .MuiDrawer-docked": { width: 0 } };

/** Everything about a tier that is pure geometry, in one lookup. */
interface TierLayout {
  anchor: "right" | "bottom";
  width: number | string;
  height?: string;
  /** `false` is a real modal drawer — the sheet, and only the sheet. */
  persistent: boolean;
  paperSx: Record<string, number | string>;
  rootSx?: Record<string, Record<string, number>>;
}

const TIER_LAYOUT: Record<PanelTier, TierLayout> = {
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

/**
 * What the panel shows with nothing selected.
 *
 * It is a STATE of the panel rather than an absence of one: the panel stays
 * docked, so deselecting does not make the canvas jump 344px wider and back
 * the moment the author clicks the next block.
 */
function PanelEmptyState({ testId }: { testId: string }): JSX.Element {
  return (
    <Box
      data-testid={`${testId}-empty`}
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6, px: 2 }}
    >
      <Text variant="body" size="sm" color="secondary">
        {EMPTY_TEXT}
      </Text>
    </Box>
  );
}

/** The form half: seeded once per selection, applied live on every edit. */
function PanelForm({
  seed,
  entities,
  span,
  onChange,
  onSpanChange,
  testId,
}: {
  seed: ReportSpecWire;
  entities: ReportEntityFields[];
  span: number;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}): JSX.Element {
  // Seeded once per opening (the caller remounts via `key`): the draft keeps
  // half-finished rows — a blank "+ Medida" line, a filter with no value yet —
  // that the serialized spec necessarily drops.
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFromSpec("", "", seed));

  const apply = (next: BuilderDraft): void => {
    const map = fieldMapOf(entities.find((candidate) => candidate.entity === next.entity));
    const valid = withValidChart(next, map);
    setDraft(valid);
    onChange(specFromDraft(valid, map));
  };

  return (
    // Scrolls inside the panel: the header and its close control stay
    // reachable however long the form gets.
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
  );
}

interface BlockEditorPanelProps {
  open: boolean;
  /**
   * Deselect. NOT "unmount": on the two wide tiers the panel stays put and
   * shows its empty state, which is what the spec asks Escape, the close
   * button and a click on the canvas background to produce.
   */
  onClose: () => void;
  entities: ReportEntityFields[];
  /** The selected block's query, or `null` for the empty state. */
  spec: ReportSpecWire | null;
  span: number;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}

export function BlockEditorPanel({
  open,
  onClose,
  entities,
  spec,
  span,
  onChange,
  onSpanChange,
  testId,
}: BlockEditorPanelProps): JSX.Element {
  const tier = usePanelTier();
  const asSheet = tier === "sheet";
  const layout = TIER_LAYOUT[tier];

  // The canvas gives up exactly the panel's width — and only where there is
  // width worth giving up, which is what makes the other two tiers overlays.
  useDockReservation(open && tier === "docked" ? PANEL_WIDTH_PX : 0);
  // The sheet is a real modal drawer, so MUI answers Escape for it already.
  useEscapeToClose(open && !asSheet, onClose);

  // A sheet has no empty state to show: it covers the canvas, so leaving it up
  // with nothing in it would hide the blocks the author is choosing between.
  if (asSheet && spec === null) return <></>;

  return (
    <Box sx={layout.rootSx} data-panel-tier={tier}>
      <Drawer
        open={open}
        onClose={onClose}
        anchor={layout.anchor}
        width={layout.width}
        height={layout.height}
        persistent={layout.persistent}
        // Docked and overlay: no modal at all, so nothing to draw. Sheet: a
        // backdrop that catches the tap above it and closes, but paints
        // nothing — the block being edited has to stay readable above it.
        backdrop={false}
        paperSx={layout.paperSx}
        dataTestId={testId}
      >
        {asSheet ? <SheetGrip onDismiss={onClose} /> : null}
        {/* Not "Close drawer" (FUT-755): this is a docked side panel, and
            `specs/editor-config-panel.feature` asks the close control to say
            what it closes. */}
        <DrawerHeader
          onClose={onClose}
          closeLabel="Fechar painel"
          dataTestId={`${testId}-header`}
        >
          <Text variant="heading" size="sm" as="h2">
            Bloco
          </Text>
        </DrawerHeader>
        <DrawerContent dataTestId={`${testId}-content`}>
          {spec === null ? (
            <PanelEmptyState testId={testId} />
          ) : (
            <PanelForm
              seed={spec}
              entities={entities}
              span={span}
              onChange={onChange}
              onSpanChange={onSpanChange}
              testId={testId}
            />
          )}
        </DrawerContent>
      </Drawer>
    </Box>
  );
}
