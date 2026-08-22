/**
 * The editor's canvas (FUT-391): the report's blocks on the SAME 12-column grid
 * the viewer uses, each one inline-editable, plus the placeholder cell that
 * adds the next block exactly where it will appear.
 *
 * Drag-and-drop is placement, not a list reorder in disguise: dropping block A
 * on block B puts A in B's slot on the canvas, so what the author drags is what
 * the reader gets.
 *
 * It is also where SELECTION lives (FUT-755). Each block used to own an
 * `editing` flag and mount its own configuration panel, and that is what made
 * the two regression scenarios in `specs/editor-config-panel.feature`
 * impossible: with the state per block, clicking another block could only open
 * a SECOND panel, and clicking the background could not deselect because
 * nothing above the blocks knew what "selected" meant. One id here, one panel
 * beside the grid, and both fall out.
 *
 * The removal CONFIRMATION lives here for the same reason: the panel's
 * *Remover* and a block's 🗑 are two entry points to one behaviour, so there is
 * one dialog rather than one per entry point (GAP 6).
 */
import { useEffect, useState, type JSX } from "react";

import { Box } from "@12-apps/ui/mui/Box";

import { blockTemplateGroups, type BlockTemplate } from "../server/block-templates";
import { useReportCopy, useReportSurface } from "./transport-context";
import { BlockTemplatePicker } from "./block-template-picker";
import type { ReportEntityFields } from "./custom-reports-api";
import {
  useDragReorder,
  useKeyboardReorder,
  type DragReorder,
  type KeyboardReorder,
} from "./lib/drag-reorder";
import { ReportGrid } from "./report-grid";
import {
  AddBlockRow,
  CanvasLiveRegion,
  RemoveBlockConfirm,
} from "./report-editor-canvas-chrome";
import { CanvasPanel } from "./report-editor-canvas-panel";
import { EditableBlock } from "./report-editor-block";
import {
  addBlock,
  blockLabel,
  duplicateBlock,
  moveBlock,
  nextBlockId,
  removeBlock,
  reorderBlock,
  REPORT_MAX_BLOCKS,
  starterBlockSpec,
  updateBlock,
  type ReportDraft,
} from "./report-model";
import type { ReportRange } from "./reports-api";

/** Which block the panel is pointed at, and whether the panel is on screen. */
import {
  blockElement,
  isBackgroundClick,
  revealBlock,
  useCanvasSelection,
  type CanvasSelection,
} from "./report-editor-selection";

interface CanvasActions {
  picking: boolean;
  openPicker: () => void;
  closePicker: () => void;
  chooseTemplate: (template: BlockTemplate) => void;
  removalTargetId: string | null;
  requestRemove: (id: string | null) => void;
  cancelRemove: () => void;
  confirmRemove: () => void;
  duplicateSelected: () => void;
  closePanel: () => void;
}

/**
 * Reveal a block once React has actually rendered it, then forget it.
 *
 * The id is set by whatever created the block; this runs on the render AFTER
 * that, which is the first one where the element exists to scroll to.
 */
function useRevealEffect(
  revealId: string | null,
  setRevealId: (id: string | null) => void,
): void {
  useEffect(() => {
    if (revealId === null) return;
    revealBlock(revealId);
    setRevealId(null);
  }, [revealId, setRevealId]);
}

function useCanvasActions({
  draft,
  first,
  startWithPicker,
  selection,
  onChange,
}: {
  draft: ReportDraft;
  /** The first catalog entity — the blank template's fallback spec. */
  first: ReportEntityFields | undefined;
  startWithPicker: boolean;
  selection: CanvasSelection;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
}): CanvasActions {
  const copy = useReportCopy().screens.builder;
  // Lazy initial state: read on mount and never again, so dismissing the
  // picker on a new report leaves a usable empty canvas rather than a modal
  // that reappears. The entity check keeps it from opening a picker whose
  // every choice would be refused for want of a catalog.
  const [picking, setPicking] = useState(() => startWithPicker && first !== undefined);
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  // A block that has just been created; cleared by the effect that reveals it,
  // once React has actually rendered it.
  const [revealId, setRevealId] = useState<string | null>(null);

  useRevealEffect(revealId, setRevealId);

  /** Select, focus and scroll to a block the author just created. */
  const landOn = (id: string): void => {
    selection.select(id);
    setRevealId(id);
  };

  return {
    picking,
    openPicker: () => setPicking(true),
    closePicker: () => setPicking(false),
    chooseTemplate: (template) => {
      setPicking(false);
      if (!first) return;
      // A template carries a ready spec; the blank one carries null and falls
      // back to the entity's starter, which is the smart default the add
      // button used to produce unconditionally.
      const spec = template.spec ?? starterBlockSpec(first);
      const title = template.spec ? template.title : first.label;
      const id = nextBlockId(draft.blocks);
      onChange((current) => addBlock(current, spec, title));
      landOn(id);
    },
    removalTargetId,
    requestRemove: setRemovalTargetId,
    cancelRemove: () => setRemovalTargetId(null),
    confirmRemove: () => {
      const id = removalTargetId;
      setRemovalTargetId(null);
      if (id === null) return;
      // Deliberately does NOT hand the panel a neighbour: the spec says
      // removing the selected block empties the panel.
      if (selection.selectedId === id) selection.deselect();
      onChange((current) => removeBlock(current, id));
    },
    duplicateSelected: () => {
      const source = selection.selectedId;
      if (source === null || draft.blocks.length >= REPORT_MAX_BLOCKS) return;
      const id = nextBlockId(draft.blocks);
      onChange((current) => duplicateBlock(current, source, copy));
      // The panel follows the copy: the reason to duplicate a block is to then
      // change something about the copy.
      landOn(id);
    },
    closePanel: () => {
      const previous = selection.selectedId;
      selection.deselect();
      blockElement(previous)?.focus();
    },
  };
}

export function EditorCanvas({
  tenantSlug,
  draft,
  entities,
  range,
  startWithPicker = false,
  onChange,
}: {
  tenantSlug: string;
  draft: ReportDraft;
  entities: ReportEntityFields[];
  range: ReportRange;
  /**
   * Open the template picker as soon as the canvas mounts — for a NEW report,
   * and only a new one (`plan.md` entry 22; `prototype.html` runs
   * `nav("edit"); openPicker()` the moment one is created).
   *
   * Threaded from the ROUTE rather than inferred from "this report has no
   * blocks": a saved report whose blocks were all deleted also has none, and
   * re-opening the picker on every visit to it would be a nuisance with no way
   * to refuse.
   */
  startWithPicker?: boolean;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
}): JSX.Element {
  const first = entities[0];
  const selection = useCanvasSelection();
  const words = useReportCopy().screens.builder;
  const actions = useCanvasActions({ draft, first, startWithPicker, selection, onChange });
  const dnd = useDragReorder((sourceId, targetId) =>
    onChange((current) => reorderBlock(current, sourceId, targetId)),
  );
  // The same reorder, without a pointer (FUT-755). It reads the blocks AS
  // RENDERED, so "one position up" means the same thing to every path that
  // uses it — the chord, and the block menu's move actions.
  const keyboard = useKeyboardReorder({
    items: draft.blocks.map((block) => ({ id: block.id, label: blockLabel(block, words) })),
    onMove: (id, delta) => onChange((current) => moveBlock(current, id, delta)),
  });
  const full = draft.blocks.length >= REPORT_MAX_BLOCKS;

  return (
    <>
      <Box onClick={(event) => (isBackgroundClick(event) ? selection.deselect() : undefined)}>
        <ReportGrid dataTestId="report-editor-grid">
          <CanvasBlocks
            tenantSlug={tenantSlug}
            draft={draft}
            range={range}
            dnd={dnd}
            keyboard={keyboard}
            selection={selection}
            onChange={onChange}
            onRequestRemove={actions.requestRemove}
          />
          <AddBlockRow disabled={full || !first} onAdd={actions.openPicker} />
          <CanvasLiveRegion text={keyboard.announcement} />
        </ReportGrid>
      </Box>
      <CanvasOverlays
        draft={draft}
        entities={entities}
        selection={selection}
        actions={actions}
        onChange={onChange}
      />
    </>
  );
}

/**
 * Everything the canvas puts ABOVE itself: the template picker, the one
 * configuration panel, and the one removal confirmation.
 *
 * Grouped so the canvas's own render function stays a description of the grid.
 */
function CanvasOverlays({
  draft,
  entities,
  selection,
  actions,
  onChange,
}: {
  draft: ReportDraft;
  entities: ReportEntityFields[];
  selection: CanvasSelection;
  actions: CanvasActions;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
}): JSX.Element {
  const surface = useReportSurface();
  const copy = useReportCopy();
  return (
    <>
      {/* "Adicionar bloco" opens the templates rather than dropping an empty
       * block on the canvas. An empty block asks the author to know their data
       * model before they have seen a number; a template shows one first and
       * lets them adjust it. The BLANK template is still in the picker, so
       * someone who knows exactly what they want is not forced through it. */}
      <BlockTemplatePicker
        open={actions.picking}
        groups={blockTemplateGroups(surface.blockTemplates, copy.blankTemplate)}
        onClose={actions.closePicker}
        onSelect={actions.chooseTemplate}
      />
      <CanvasPanel
        draft={draft}
        entities={entities}
        selectedId={selection.selectedId}
        everOpened={selection.everOpened}
        onClose={actions.closePanel}
        onChange={onChange}
        onDuplicate={actions.duplicateSelected}
        onRemove={() => actions.requestRemove(selection.selectedId)}
      />
      <RemoveBlockConfirm
        targetId={actions.removalTargetId}
        onConfirm={actions.confirmRemove}
        onCancel={actions.cancelRemove}
      />
    </>
  );
}

/** The blocks themselves, wired to the canvas's selection. */
function CanvasBlocks({
  tenantSlug,
  draft,
  range,
  dnd,
  keyboard,
  selection,
  onChange,
  onRequestRemove,
}: {
  tenantSlug: string;
  draft: ReportDraft;
  range: ReportRange;
  dnd: DragReorder;
  keyboard: KeyboardReorder;
  selection: CanvasSelection;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
  onRequestRemove: (id: string) => void;
}): JSX.Element {
  return (
    <>
      {draft.blocks.map((block) => (
        <EditableBlock
          key={block.id}
          tenantSlug={tenantSlug}
          block={block}
          range={range}
          dnd={dnd}
          keyboard={keyboard}
          selected={selection.selectedId === block.id}
          onSelect={() => selection.select(block.id)}
          onTitleChange={(title) =>
            onChange((current) => updateBlock(current, block.id, { title }))
          }
          onRemove={() => onRequestRemove(block.id)}
        />
      ))}
    </>
  );
}
