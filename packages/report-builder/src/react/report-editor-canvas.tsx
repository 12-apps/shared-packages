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
import { useEffect, useState, type JSX, type MouseEvent as ReactMouseEvent } from "react";

import { Box } from "@12-apps/ui/mui/Box";

import { blockTemplateGroups, type BlockTemplate } from "../server/block-templates";
import { useReportSurface } from "./transport-context";
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
import { BLOCK_ID_ATTR, EditableBlock } from "./report-editor-block";
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
interface CanvasSelection {
  selectedId: string | null;
  /**
   * Opened by the FIRST selection and never closed again on the wide tiers:
   * deselecting leaves the panel docked showing its empty state, so the canvas
   * does not snap 344px wider and back between two clicks. Before the first
   * selection there is no panel at all, which is what lets the reflow be
   * observable ("I note the width of the canvas … the canvas width is reduced
   * by the width of the panel").
   */
  everOpened: boolean;
  select: (id: string) => void;
  deselect: () => void;
}

function useCanvasSelection(): CanvasSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [everOpened, setEverOpened] = useState(false);

  return {
    selectedId,
    everOpened,
    select: (id) => {
      setSelectedId(id);
      setEverOpened(true);
    },
    deselect: () => setSelectedId(null),
  };
}

/**
 * Did this click land on the canvas BACKGROUND rather than on a block?
 *
 * Asked of the click's ORIGIN rather than of the wrapper, because the grid's
 * gaps and a block's own padding are both "not a block" and both bubble to the
 * same element. The panel is rendered outside this wrapper, so a click inside
 * the panel never reaches here at all — "clicking inside the panel never
 * deselects" is structural rather than a guard that can be forgotten.
 *
 * The containment test is NOT redundant with that. A block's menu and the
 * remove confirmation render into portals at `document.body`, and React
 * bubbles their clicks along the REACT tree regardless — so "Mover para cima"
 * and "Cancelar" arrive here with a target that is outside every block and
 * outside this element, and without the check each of them silently emptied
 * the panel on its way out. Found in Chromium; jsdom bubbles portals the same
 * way, but only a real menu makes it obvious.
 */
function isBackgroundClick(event: ReactMouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (!event.currentTarget.contains(target)) return false;
  return target.closest(`[${BLOCK_ID_ATTR}]`) === null;
}

/** Find a block's element again — for focus, and for scrolling to it. */
function blockElement(id: string | null): HTMLElement | null {
  if (id === null) return null;
  return document.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${id}"]`);
}

/**
 * Bring a just-created block to the author: focus it, and scroll it to the
 * middle of the viewport.
 *
 * Without the scroll, adding to a canvas already a screen tall appends the
 * block below the fold and nothing appears to have happened (`plan.md` entry
 * 18). `scrollIntoView` is called optionally because jsdom does not implement
 * it, and a test environment must not be the reason a feature is left out.
 */
function revealBlock(id: string): void {
  const element = blockElement(id);
  if (element === null) return;
  element.focus();
  element.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

/** Everything the canvas can DO, so its render function only renders. */
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
  // Lazy initial state: read on mount and never again, so dismissing the
  // picker on a new report leaves a usable empty canvas rather than a modal
  // that reappears. The entity check keeps it from opening a picker whose
  // every choice would be refused for want of a catalog.
  const [picking, setPicking] = useState(() => startWithPicker && first !== undefined);
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  // A block that has just been created; cleared by the effect that reveals it,
  // once React has actually rendered it.
  const [revealId, setRevealId] = useState<string | null>(null);

  useEffect(() => {
    if (revealId === null) return;
    revealBlock(revealId);
    setRevealId(null);
  }, [revealId]);

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
      onChange((current) => duplicateBlock(current, source));
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
  const actions = useCanvasActions({ draft, first, startWithPicker, selection, onChange });
  const dnd = useDragReorder((sourceId, targetId) =>
    onChange((current) => reorderBlock(current, sourceId, targetId)),
  );
  // The same reorder, without a pointer (FUT-755). It reads the blocks AS
  // RENDERED, so "one position up" means the same thing to every path that
  // uses it — the chord, and the block menu's move actions.
  const keyboard = useKeyboardReorder({
    items: draft.blocks.map((block) => ({ id: block.id, label: blockLabel(block) })),
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
  return (
    <>
      {/* "Adicionar bloco" opens the templates rather than dropping an empty
       * block on the canvas. An empty block asks the author to know their data
       * model before they have seen a number; a template shows one first and
       * lets them adjust it. The BLANK template is still in the picker, so
       * someone who knows exactly what they want is not forced through it. */}
      <BlockTemplatePicker
        open={actions.picking}
        groups={blockTemplateGroups(surface.blockTemplates)}
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
