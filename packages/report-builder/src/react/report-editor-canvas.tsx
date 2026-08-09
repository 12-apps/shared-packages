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
 */
import { useState, type JSX, type MouseEvent as ReactMouseEvent } from "react";

import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_GRID_COLUMNS } from "../layout";
import { blockTemplateGroups, type BlockTemplate } from "../server/block-templates";
import { BlockEditorPanel } from "./block-editor-panel";
import { BlockTemplatePicker } from "./block-template-picker";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";
import { PlusIcon } from "./lib/block-icons";
import {
  useDragReorder,
  useKeyboardReorder,
  type DragReorder,
  type KeyboardReorder,
} from "./lib/drag-reorder";
import { ReportGrid, ReportGridItem } from "./report-grid";
import { BLOCK_ID_ATTR, EditableBlock } from "./report-editor-block";
import {
  addBlock,
  blockLabel,
  moveBlock,
  removeBlock,
  reorderBlock,
  REPORT_MAX_BLOCKS,
  starterBlockSpec,
  updateBlock,
  updateBlockSpec,
  type ReportDraft,
} from "./report-model";
import type { ReportRange } from "./reports-api";

/**
 * The add affordance: a full-row dashed strip closing the canvas, with a large
 * ⊕ centred in it. A whole row (never a block-sized cell) because it is not a
 * block — it is the seam where the next one lands, and it should read as one
 * at any width.
 */
function AddBlockRow({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }): JSX.Element {
  return (
    <ReportGridItem span={REPORT_GRID_COLUMNS} dataTestId="report-editor-add-cell">
      <Card
        variant="outlined"
        sx={{ borderStyle: "dashed", p: 0, overflow: "hidden" }}
      >
        <Box
          component="button"
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label="Adicionar bloco"
          data-testid="report-editor-add-block"
          sx={{
            width: "100%",
            minHeight: 96,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            border: 0,
            background: "transparent",
            color: disabled ? "text.disabled" : "primary.main",
            cursor: disabled ? "not-allowed" : "pointer",
            "&:hover": { bgcolor: disabled ? "transparent" : "action.hover" },
          }}
        >
          <PlusIcon />
          <Text variant="body" size="xs" color="secondary">
            {disabled
              ? `Limite de ${REPORT_MAX_BLOCKS} blocos por relatório.`
              : "Adicionar bloco — gráfico, tabela ou indicador"}
          </Text>
        </Box>
      </Card>
    </ReportGridItem>
  );
}

/**
 * The canvas's one polite live region: where a reorder says what it did.
 *
 * Absolutely positioned, so it is NOT a grid item — a visually hidden cell
 * would still open a twelfth-column row and put a gap under the canvas.
 */
function CanvasLiveRegion({ text }: { text: string }): JSX.Element {
  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="report-editor-live-region"
      sx={{
        position: "absolute",
        width: "1px",
        height: "1px",
        p: 0,
        m: "-1px",
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {text}
    </Box>
  );
}

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
 * The containment test is NOT redundant with that. A block's menu and its
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

/** Put focus back on a block after the panel lets go of it. */
function focusBlock(id: string | null): void {
  if (id === null) return;
  document.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${id}"]`)?.focus();
}

export function EditorCanvas({
  tenantSlug,
  draft,
  entities,
  range,
  onChange,
}: {
  tenantSlug: string;
  draft: ReportDraft;
  entities: ReportEntityFields[];
  range: ReportRange;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);
  const selection = useCanvasSelection();
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
  const first = entities[0];

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
          />
          <AddBlockRow disabled={full || !first} onAdd={() => setPicking(true)} />
          <CanvasLiveRegion text={keyboard.announcement} />
        </ReportGrid>
      </Box>
      {/* "Adicionar bloco" opens the templates rather than dropping an empty
       * block on the canvas. An empty block asks the author to know their data
       * model before they have seen a number; a template shows one first and
       * lets them adjust it. The BLANK template is still in the picker, so
       * someone who knows exactly what they want is not forced through it. */}
      <BlockTemplatePicker
        open={picking}
        groups={blockTemplateGroups()}
        onClose={() => setPicking(false)}
        onSelect={(template: BlockTemplate) => {
          setPicking(false);
          if (!first) return;
          // A template carries a ready spec; the blank one carries null and
          // falls back to the entity's starter, which is the smart default the
          // add button used to produce unconditionally.
          const spec = template.spec ?? starterBlockSpec(first);
          const title = template.spec ? template.title : first.label;
          onChange((current) => addBlock(current, spec, title));
        }}
      />
      <CanvasPanel
        draft={draft}
        entities={entities}
        selection={selection}
        onChange={onChange}
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
}: {
  tenantSlug: string;
  draft: ReportDraft;
  range: ReportRange;
  dnd: DragReorder;
  keyboard: KeyboardReorder;
  selection: CanvasSelection;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
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
          onRemove={() => {
            // Deliberately does NOT hand the panel a neighbour: the spec says
            // removing the selected block empties the panel.
            if (selection.selectedId === block.id) selection.deselect();
            onChange((current) => removeBlock(current, block.id));
          }}
        />
      ))}
    </>
  );
}

/** What the one panel is pointed at, flattened so its JSX has no branches. */
interface PanelTarget {
  /** Remount key: a new block re-seeds the form and resets its scroll. */
  key: string;
  spec: ReportSpecWire | null;
  span: number;
  testId: string;
  /** `null` in the empty state — nothing to edit, so nothing to patch. */
  id: string | null;
}

function panelTarget(draft: ReportDraft, selectedId: string | null): PanelTarget {
  const block = draft.blocks.find((candidate) => candidate.id === selectedId);
  if (block === undefined) {
    return {
      key: "sem-selecao",
      spec: null,
      span: REPORT_GRID_COLUMNS,
      testId: "report-editor-panel",
      id: null,
    };
  }
  // The test id is the one future-pay's reports e2e drives, so it stays keyed
  // by the BLOCK even though the panel no longer belongs to one.
  return {
    key: block.id,
    spec: block.spec,
    span: block.span,
    testId: `report-block-${block.id}-editor`,
    id: block.id,
  };
}

/**
 * The canvas's ONE configuration panel — the whole point of lifting the
 * selection. Keyed by the selected block so switching re-seeds the form and
 * resets its scroll, while re-clicking the same block leaves both alone.
 */
function CanvasPanel({
  draft,
  entities,
  selection,
  onChange,
}: {
  draft: ReportDraft;
  entities: ReportEntityFields[];
  selection: CanvasSelection;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
}): JSX.Element | null {
  if (!selection.everOpened) return null;

  const target = panelTarget(draft, selection.selectedId);
  const apply = (next: (current: ReportDraft, id: string) => ReportDraft): void => {
    const id = target.id;
    if (id !== null) onChange((current) => next(current, id));
  };

  return (
    <BlockEditorPanel
      key={target.key}
      open
      onClose={() => {
        selection.deselect();
        focusBlock(selection.selectedId);
      }}
      entities={entities}
      spec={target.spec}
      span={target.span}
      onChange={(spec) => apply((current, id) => updateBlockSpec(current, id, spec))}
      onSpanChange={(span) => apply((current, id) => updateBlock(current, id, { span }))}
      testId={target.testId}
    />
  );
}
