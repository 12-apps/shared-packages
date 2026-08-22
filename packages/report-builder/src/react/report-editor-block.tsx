/**
 * One block in EDIT mode (FUT-391): the exact frame the viewer draws, with its
 * chrome added inline — grip, title, ✎, ⋮ and 🗑 — and its body rendered from a
 * LIVE run of the block's current spec. Chart, table and KPI all render exactly
 * as they will be read; nothing about editing degrades the rendering.
 *
 * The body is the point: adding a block or changing its query immediately
 * fetches and renders real data for the selected period, so the author is
 * laying out the actual report, not placeholders that will surprise them after
 * the first save.
 *
 * SELECTION LIVES ON THE CANVAS, not here (FUT-755). A block used to own an
 * `editing` flag and mount its own config panel, which made "click another
 * block" mean "open a second panel" — the spec asks for one panel that
 * RETARGETS. So this component is told whether it is the selected one and
 * reports clicks upward; `report-editor-canvas.tsx` owns the answer.
 */
import type { JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import type { DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";

import { useRunReport, type ReportSpecWire } from "./custom-reports-api";
import { GripIcon, PencilIcon, TrashIcon } from "./lib/block-icons";
import type { DragReorder, KeyboardReorder } from "./lib/drag-reorder";
import { CONTAINER_RADIUS_PX } from "./lib/report-surface";
import { OverflowToolCluster, TOOL_ROW } from "./lib/tool-cluster";
import { ReportBlockFrame, ReportGridItem } from "./report-grid";
import { ReportRenderView } from "./report-render";
import { blockLabel, type ReportBlockDraft } from "./report-model";
import type { ReportRange } from "./reports-api";
import type { ReportEditorCopy } from "./screens-copy";
import { useReportCopy } from "./transport-context";

/**
 * The ring a block wears when it is FOCUSED or SELECTED — the block group is a
 * container rather than a control, so it has no ring of its own.
 *
 * One look for both states on purpose: they coincide nearly always (the panel
 * follows the selection, and the keyboard reorder focuses the block it moved),
 * and two rings on one element would read as two unrelated things. It is SOLID
 * where the drop target's is dashed, so "the panel is editing this" and "the
 * drag will land here" stay distinguishable.
 */
const BLOCK_RING = {
  outline: "2px solid",
  outlineColor: "primary.main",
  outlineOffset: "2px",
} as const;

/**
 * How the canvas finds a block's element again — to put focus back on it when
 * the panel closes, and to tell a click on a block apart from a click on the
 * background behind one.
 */
export const BLOCK_ID_ATTR = "data-report-block-id";

/** The live preview: the same renderer the viewer uses, over a dry run. */
function BlockPreview({
  tenantSlug,
  spec,
  range,
  fill,
  testId,
}: {
  tenantSlug: string;
  spec: ReportSpecWire;
  range: ReportRange;
  /** The block has a chosen height, so the rendering must take it (FUT-755). */
  fill: boolean;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.editor;
  const preview = useRunReport(tenantSlug, spec, range);
  if (preview.isError) {
    return (
      <Alert severity="error" data-testid={`${testId}-error`}>
        {preview.error instanceof Error
          ? preview.error.message
          : copy.blockRunFailed}
      </Alert>
    );
  }
  if (!preview.data) return <LoadingState dataTestId={`${testId}-loading`} />;
  return (
    <ReportRenderView render={preview.data.render} dataTestId={`${testId}-render`} fill={fill} />
  );
}

/** Grip + inline title — the frame's title slot while editing. */
function BlockTitleSlot({
  block,
  dnd,
  testId,
  onTitleChange,
}: {
  block: ReportBlockDraft;
  dnd: DragReorder;
  testId: string;
  onTitleChange: (title: string) => void;
}): JSX.Element {
  const copy = useReportCopy().screens.editor;
  // A floor, not `minWidth: 0` (FUT-755). A title slot allowed to shrink to
  // zero always wins the argument with the chrome beside it: at 1024px with
  // the panel open the input measured 36px against 170px of title and the
  // block was headed `Rec`.
  //
  // It is `TOOL_ROW.title` rather than a literal, because the cluster PRICES
  // the title at that number when it decides how many tools fit. A CSS floor
  // that let the title take more than the arithmetic assumed would mean the
  // row sheds nothing and overflows anyway — which is the bug, one level down.
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flex: 1, minWidth: `${TOOL_ROW.title}px` }}
    >
      <Box
        {...dnd.handleProps(block.id)}
        sx={{ cursor: "grab", userSelect: "none", display: "inline-flex", color: "text.secondary" }}
        // The label names the keyboard path too. A shortcut nobody is told
        // about is only half an alternative to the drag.
        aria-label="Arraste para posicionar. Ou use Alt e as setas."
        title={copy.blockDragHint}
        data-testid={`${testId}-drag-handle`}
      >
        <GripIcon />
      </Box>
      <Input
        size="sm"
        aria-label={copy.blockTitleLabel}
        placeholder={copy.blockTitleLabel}
        value={block.title}
        onChange={(event) => onTitleChange(event.target.value)}
        data-testid={`${testId}-title`}
      />
    </Stack>
  );
}

/**
 * The EXPLICIT move actions — the two items the ⋮ carries at every width.
 *
 * `specs/editor-direct-manipulation.feature`'s `@drag @mobile` scenario asks
 * for them by name and gives the reason: on a phone the canvas is one column
 * tall, so moving a block by drag means holding a long press past sticky
 * chrome while the page scrolls under the thumb. Two menu items do it in one
 * tap.
 *
 * They call the KEYBOARD path (`keyboard.move`), not `moveBlock`: that is what
 * announces the new position in the canvas's live region and puts focus back
 * on the block that moved. Reimplementing the move here would silently drop
 * both, on the tier where they matter most.
 *
 * They are also why the editor's ⋮ is ALWAYS on the row: a cluster with
 * permanent menu items always has a trigger to render, so the escape hatch
 * that ✎ and 🗑 overflow into is never itself missing.
 */
function moveItems(
  block: ReportBlockDraft,
  keyboard: KeyboardReorder,
  copy: ReportEditorCopy,
): DropdownMenuItem[] {
  return [
    {
      id: "move-up",
      label: copy.moveUp,
      disabled: !keyboard.canMove(block.id, -1),
      onClick: () => keyboard.move(block.id, -1),
    },
    {
      id: "move-down",
      label: copy.moveDown,
      disabled: !keyboard.canMove(block.id, 1),
      onClick: () => keyboard.move(block.id, 1),
    },
  ];
}

/**
 * ✎ + 🗑 + ⋮ — the block's edit chrome, pinned top-right and never wrapped.
 *
 * RANKED, which is what decides who keeps a visible slot when the block is too
 * narrow for both icons: ✎ is the block's primary action and the only route
 * into its configuration, while 🗑 is the one whose accidental prominence
 * costs the most. So the trash sheds first — and a delete that has to be found
 * in a menu, read, and chosen is a delete that is harder to hit by mistake.
 * It stays destructive either way: the same handler, and the same confirm.
 *
 * There is deliberately NO "ver como tabela" here. `prototype.html`'s edit-mode
 * cluster is duplicate + delete, and its table/CSV pair is view-mode only
 * (`blockHTML`, the `editable` branch) — an author choosing a visualization
 * should be looking at the visualization they chose, and the picker is where
 * that decision is made.
 */
function BlockActions({
  block,
  keyboard,
  testId,
  onEdit,
  onRemove,
}: {
  block: ReportBlockDraft;
  keyboard: KeyboardReorder;
  testId: string;
  onEdit: () => void;
  onRemove: () => void;
}): JSX.Element | null {
  const copy = useReportCopy().screens.editor;
  return (
    <OverflowToolCluster
      tools={[
        {
          id: "edit",
          label: "Editar bloco",
          icon: <PencilIcon />,
          onSelect: onEdit,
          dataTestId: `${testId}-edit`,
        },
        {
          id: "remove",
          label: "Remover bloco",
          icon: <TrashIcon />,
          onSelect: onRemove,
          dataTestId: `${testId}-remove`,
          danger: true,
        },
      ]}
      menuItems={moveItems(block, keyboard, copy)}
      menuTestId={`${testId}-menu`}
      menuLabel={copy.blockMenu}
    />
  );
}

/**
 * A named, focusable group around the block's frame — and the reason it is
 * here rather than on `ReportGridItem`: the grid item is shared with the
 * viewer, and this is the tab stop the reorder shortcut needs. Without
 * something to focus, Alt+↑/↓ has nothing to be pressed on.
 *
 * It is also the click target that SELECTS the block: the spec's regression
 * case is a click "in the middle of the canvas, on the body of another block",
 * so the whole frame selects, not just the ✎.
 */
/**
 * Enter on the BLOCK ITSELF selects it.
 *
 * The keyboard equivalent of clicking its body, and the only way to reach the
 * panel without tabbing past the block's chrome. The target check is what
 * keeps Enter in the title field — which bubbles from inside this group —
 * from being read as a selection.
 */
function selectOnEnter(event: React.KeyboardEvent, onSelect: () => void): void {
  if (event.defaultPrevented || event.key !== "Enter") return;
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  onSelect();
}

function BlockGroup({
  tenantSlug,
  block,
  range,
  dnd,
  keyboard,
  selected,
  testId,
  onSelect,
  onTitleChange,
  onRemove,
}: {
  tenantSlug: string;
  block: ReportBlockDraft;
  range: ReportRange;
  dnd: DragReorder;
  keyboard: KeyboardReorder;
  selected: boolean;
  testId: string;
  onSelect: () => void;
  onTitleChange: (title: string) => void;
  onRemove: () => void;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const reorder = keyboard.blockProps(block.id);

  return (
    <Box
      {...reorder}
      {...{ [BLOCK_ID_ATTR]: block.id }}
      role="group"
      aria-label={blockLabel(block, copy)}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      data-selected={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        reorder.onKeyDown(event);
        selectOnEnter(event, onSelect);
      }}
      sx={{
        borderRadius: `${CONTAINER_RADIUS_PX}px`,
        "&:focus-visible": BLOCK_RING,
        ...(selected ? BLOCK_RING : {}),
      }}
    >
      <ReportBlockFrame
        dataTestId={testId}
        active={dnd.overId === block.id}
        fill={block.height !== undefined}
        title={
          <BlockTitleSlot block={block} dnd={dnd} testId={testId} onTitleChange={onTitleChange} />
        }
        actions={
          <BlockActions
            block={block}
            keyboard={keyboard}
            testId={testId}
            onEdit={onSelect}
            onRemove={onRemove}
          />
        }
      >
        <BlockPreview
          tenantSlug={tenantSlug}
          spec={block.spec}
          range={range}
          fill={block.height !== undefined}
          testId={testId}
        />
      </ReportBlockFrame>
    </Box>
  );
}

export function EditableBlock({
  tenantSlug,
  block,
  range,
  dnd,
  keyboard,
  selected,
  onSelect,
  onTitleChange,
  onRemove,
}: {
  tenantSlug: string;
  block: ReportBlockDraft;
  range: ReportRange;
  dnd: DragReorder;
  /** The Alt+↑/↓ path — the block is the thing it is pressed on. */
  keyboard: KeyboardReorder;
  /** Whether the canvas's one config panel is currently pointed at this block. */
  selected: boolean;
  onSelect: () => void;
  onTitleChange: (title: string) => void;
  /**
   * REQUESTS removal — it does not perform it. The confirmation lives on the
   * CANVAS (FUT-755, GAP 6), because the configuration panel's *Remover* has
   * to open the same dialog this 🗑 does. Owned here, the panel's remove would
   * have needed a second confirmation, with its own copy and its own bugs.
   */
  onRemove: () => void;
}): JSX.Element {
  const testId = `report-block-${block.id}`;

  return (
    <ReportGridItem
      span={block.span}
      height={block.height}
      dataTestId={`${testId}-cell`}
      dropProps={dnd.targetProps(block.id)}
    >
      <BlockGroup
        tenantSlug={tenantSlug}
        block={block}
        range={range}
        dnd={dnd}
        keyboard={keyboard}
        selected={selected}
        testId={testId}
        onSelect={onSelect}
        onTitleChange={onTitleChange}
        onRemove={onRemove}
      />
    </ReportGridItem>
  );
}
