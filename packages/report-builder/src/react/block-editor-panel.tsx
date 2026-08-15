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
 * What it SAYS is GAPs 6 and 7 of the hand-test (FUT-755). The header used to
 * read `Bloco` — true of every block, so the panel opened having said nothing
 * about the one it was pointed at — and there was no way to copy or drop a
 * block without going back to the canvas. It now leads with the block's spec
 * sentence, offers the title that overrides it, and closes with *Duplicar* /
 * *Remover*. All three live in `lib/block-panel-chrome.tsx`; the sentence
 * itself comes from the engine's own `specSentence`, through the catalog
 * adapter in `lib/spec-sentence.ts`, so the panel and the saved card cannot
 * describe one block two ways.
 *
 * The test ids are unchanged from the popover on purpose: `report-block-<id>-editor`
 * and `-editor-entity` are driven by the origin host's reports e2e, so swapping the
 * container must not break a consumer's suite.
 */
import { useMemo, useState, type JSX } from "react";

import { Drawer, DrawerContent, DrawerHeader } from "@12-apps/ui/layout/Drawer";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { BlockQueryFields, fieldMapOf } from "./block-query-fields";
import { draftFromSpec, specFromDraft, withValidChart, type BuilderDraft } from "./builder-model";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";
import {
  BlockPanelEmptyState,
  BlockPanelFooter,
  BlockSpecSentence,
  BlockTitleField,
} from "./lib/block-panel-chrome";
import { useDockReservation, useEscapeToClose, usePanelTier } from "./lib/docked-panel";
import { PANEL_WIDTH_PX, SheetGrip, TIER_LAYOUT } from "./lib/panel-tiers";
import {
  blockAutoTitle,
  blockSentence,
  catalogFromEntities,
  sentenceParts,
  type SentencePart,
} from "./lib/spec-sentence";
import { REPORT_MAX_BLOCKS } from "./report-model";

/**
 * The panel's own name for itself, in the prototype's two states.
 *
 * `Bloco` alone was the GAP-7 defect: it is true of every block, so the panel
 * opened saying nothing about the one it had just been pointed at. The heading
 * now says what the panel is DOING, and the sentence below it says to what.
 */
const IDLE_HEADING = "Bloco";
const EDITING_HEADING = "Editando bloco";

/** Why *Duplicar* is refused — the canvas's own wording for the same ceiling. */
const DUPLICATE_BLOCKED_TEXT = `Limite de ${REPORT_MAX_BLOCKS} blocos por relatório.`;

/**
 * Everything the panel knows about the selected block, recomputed on every
 * edit — which is the point of GAP 7: the sentence is live feedback, not a
 * caption written once when the panel opened.
 *
 * Bundling the spec with its description is what lets the whole panel branch on
 * ONE nullable value: `null` is the empty state, and anything else carries a
 * block, its words and its automatic name together.
 */
interface SelectedBlock {
  spec: ReportSpecWire;
  /** The spec sentence, split into the runs the panel emphasises. */
  parts: SentencePart[];
  /** What the block is called while its title is empty. */
  autoTitle: string;
}

function useSelectedBlock(
  spec: ReportSpecWire | null,
  entities: ReportEntityFields[],
): SelectedBlock | null {
  const catalog = useMemo(() => catalogFromEntities(entities), [entities]);
  return useMemo(() => {
    if (spec === null) return null;
    return {
      spec,
      parts: sentenceParts(blockSentence(spec, catalog)),
      autoTitle: blockAutoTitle(spec, catalog),
    };
  }, [spec, catalog]);
}

/** The form half: seeded once per selection, applied live on every edit. */
function PanelForm({
  block,
  entities,
  span,
  height,
  title,
  onChange,
  onSpanChange,
  onHeightChange,
  onTitleChange,
  testId,
}: {
  block: SelectedBlock;
  entities: ReportEntityFields[];
  span: number;
  height: number | undefined;
  title: string;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  onHeightChange: (height: number | undefined) => void;
  onTitleChange: (title: string) => void;
  testId: string;
}): JSX.Element {
  const seed = block.spec;
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
    // reachable however long the form gets. The top padding is not spacing —
    // a floating label sits ABOVE its field's border, so with the first field
    // flush against the scroll container's edge "Coleção" was clipped in half
    // by the overflow.
    <Box sx={{ overflowY: "auto", pt: 1.5, pb: 2 }}>
      <Stack spacing={2}>
        {/* First field in the form, directly under the sentence it overrides —
            `prototype.html` orders it exactly so. */}
        <BlockTitleField
          title={title}
          autoTitle={block.autoTitle}
          onTitleChange={onTitleChange}
          testId={testId}
        />
        <BlockQueryFields
          draft={draft}
          entities={entities}
          span={span}
          height={height}
          apply={apply}
          onSpanChange={onSpanChange}
          onHeightChange={onHeightChange}
          testId={testId}
        />
      </Stack>
    </Box>
  );
}

/**
 * Everything below the header: the spec sentence, the form (or the empty state)
 * and the footer.
 *
 * One component because all three answer the SAME question — is a block
 * selected — and answering it once here keeps `BlockEditorPanel` about which
 * responsive tier it is in, which is the only other thing it decides.
 */
function PanelBody({
  block,
  entities,
  span,
  height,
  title,
  canDuplicate,
  onChange,
  onSpanChange,
  onHeightChange,
  onTitleChange,
  onDuplicate,
  onRemove,
  testId,
}: {
  block: SelectedBlock | null;
  entities: ReportEntityFields[];
  span: number;
  height: number | undefined;
  title: string;
  canDuplicate: boolean;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  onHeightChange: (height: number | undefined) => void;
  onTitleChange: (title: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  testId: string;
}): JSX.Element {
  // Nothing selected: the prompt, and NO footer — there is nothing to copy and
  // nothing to drop, so either control would be one that cannot mean anything.
  if (block === null) {
    return (
      <DrawerContent dataTestId={`${testId}-content`}>
        <BlockPanelEmptyState testId={testId} />
      </DrawerContent>
    );
  }

  return (
    <>
      {/* Outside `DrawerContent`, which is the scrolling half: the sentence has
          to stay readable while the author is at the bottom of the form
          changing the very thing it describes. */}
      <BlockSpecSentence parts={block.parts} testId={testId} />
      <DrawerContent dataTestId={`${testId}-content`}>
        <PanelForm
          block={block}
          entities={entities}
          span={span}
          height={height}
          title={title}
          onChange={onChange}
          onSpanChange={onSpanChange}
          onHeightChange={onHeightChange}
          onTitleChange={onTitleChange}
          testId={testId}
        />
      </DrawerContent>
      <BlockPanelFooter
        canDuplicate={canDuplicate}
        blockedReason={DUPLICATE_BLOCKED_TEXT}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        testId={testId}
      />
    </>
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
  /** The block's height tier, or `undefined` for its own content height. */
  height: number | undefined;
  /** The block's title override. Empty string means "use the auto description". */
  title: string;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  onHeightChange: (height: number | undefined) => void;
  onTitleChange: (title: string) => void;
  onDuplicate: () => void;
  /** False at REPORT_MAX_BLOCKS — the control stays visible and explains why. */
  canDuplicate: boolean;
  /**
   * Ask the canvas to remove the selected block. It owns the confirmation, so
   * this is a second entry point to the block's own 🗑 and not a second
   * behaviour — see `BlockPanelFooter`.
   */
  onRemove: () => void;
  testId: string;
}

export function BlockEditorPanel({
  open,
  onClose,
  entities,
  spec,
  span,
  height,
  title,
  onChange,
  onSpanChange,
  onHeightChange,
  onTitleChange,
  onDuplicate,
  canDuplicate,
  onRemove,
  testId,
}: BlockEditorPanelProps): JSX.Element {
  const tier = usePanelTier();
  const asSheet = tier === "sheet";
  const layout = TIER_LAYOUT[tier];
  const block = useSelectedBlock(spec, entities);

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
            {block === null ? IDLE_HEADING : EDITING_HEADING}
          </Text>
        </DrawerHeader>
        <PanelBody
          block={block}
          entities={entities}
          span={span}
          height={height}
          title={title}
          canDuplicate={canDuplicate}
          onChange={onChange}
          onSpanChange={onSpanChange}
          onHeightChange={onHeightChange}
          onTitleChange={onTitleChange}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          testId={testId}
        />
      </Drawer>
    </Box>
  );
}
