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
import { useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { DropdownMenu, type DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";

import { useRunReport, type ReportSpecWire } from "./custom-reports-api";
import { GripIcon, PencilIcon, TrashIcon } from "./lib/block-icons";
import { ConfirmDialog } from "./lib/confirm-dialog";
import type { DragReorder, KeyboardReorder } from "./lib/drag-reorder";
import { ReportBlockFrame, ReportGridItem } from "./report-grid";
import { ReportRenderView } from "./report-render";
import { blockLabel, type ReportBlockDraft } from "./report-model";
import type { ReportRange } from "./reports-api";

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
  testId,
}: {
  tenantSlug: string;
  spec: ReportSpecWire;
  range: ReportRange;
  testId: string;
}): JSX.Element {
  const preview = useRunReport(tenantSlug, spec, range);
  if (preview.isError) {
    return (
      <Alert severity="error" data-testid={`${testId}-error`}>
        {preview.error instanceof Error
          ? preview.error.message
          : "Não foi possível executar este bloco."}
      </Alert>
    );
  }
  if (!preview.data) return <LoadingState dataTestId={`${testId}-loading`} />;
  return <ReportRenderView render={preview.data.render} dataTestId={`${testId}-render`} />;
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
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1, minWidth: 0 }}>
      <Box
        {...dnd.handleProps(block.id)}
        sx={{ cursor: "grab", userSelect: "none", display: "inline-flex", color: "text.secondary" }}
        // The label names the keyboard path too. A shortcut nobody is told
        // about is only half an alternative to the drag.
        aria-label="Arraste para posicionar. Ou use Alt e as setas."
        title="Arraste ou Alt+↑/↓"
        data-testid={`${testId}-drag-handle`}
      >
        <GripIcon />
      </Box>
      <Input
        size="sm"
        aria-label="Título do bloco"
        placeholder="Título do bloco"
        value={block.title}
        onChange={(event) => onTitleChange(event.target.value)}
        data-testid={`${testId}-title`}
      />
    </Stack>
  );
}

/**
 * The block's overflow menu — where the EXPLICIT move actions live.
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
 */
function BlockMenu({
  block,
  keyboard,
  testId,
}: {
  block: ReportBlockDraft;
  keyboard: KeyboardReorder;
  testId: string;
}): JSX.Element {
  const items: DropdownMenuItem[] = [
    {
      id: "move-up",
      label: "Mover para cima",
      disabled: !keyboard.canMove(block.id, -1),
      onClick: () => keyboard.move(block.id, -1),
    },
    {
      id: "move-down",
      label: "Mover para baixo",
      disabled: !keyboard.canMove(block.id, 1),
      onClick: () => keyboard.move(block.id, 1),
    },
  ];

  return (
    <DropdownMenu
      size="sm"
      items={items}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Mais ações do bloco"
          dataTestId={`${testId}-menu`}
        >
          ⋮
        </Button>
      }
    />
  );
}

/** ✎ + ⋮ + 🗑 — the block's edit chrome, kept to icons so it fits any width. */
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
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Editar bloco"
        onClick={onEdit}
        dataTestId={`${testId}-edit`}
      >
        <PencilIcon />
      </Button>
      <BlockMenu block={block} keyboard={keyboard} testId={testId} />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Remover bloco"
        onClick={onRemove}
        dataTestId={`${testId}-remove`}
      >
        <TrashIcon />
      </Button>
    </Stack>
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
  const reorder = keyboard.blockProps(block.id);

  return (
    <Box
      {...reorder}
      {...{ [BLOCK_ID_ATTR]: block.id }}
      role="group"
      aria-label={blockLabel(block)}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      data-selected={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        reorder.onKeyDown(event);
        // Enter on the BLOCK ITSELF selects it — the keyboard equivalent of
        // clicking its body, and the only way to reach the panel without
        // tabbing past the block's chrome. The target check is what keeps
        // Enter in the title field (which bubbles from inside this group)
        // from being read as a selection.
        if (event.defaultPrevented || event.key !== "Enter") return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onSelect();
      }}
      sx={{
        height: "100%",
        borderRadius: 1,
        "&:focus-visible": BLOCK_RING,
        ...(selected ? BLOCK_RING : {}),
      }}
    >
      <ReportBlockFrame
        dataTestId={testId}
        active={dnd.overId === block.id}
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
        <BlockPreview tenantSlug={tenantSlug} spec={block.spec} range={range} testId={testId} />
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
  onRemove: () => void;
}): JSX.Element {
  const testId = `report-block-${block.id}`;
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <ReportGridItem
      span={block.span}
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
        onRemove={() => setConfirmingRemove(true)}
      />
      {/* Outside the focusable group on purpose: the confirmation is not part
       * of the block for keyboard purposes, and Alt+↑/↓ typed inside it must
       * not reorder the canvas behind it. */}
      <ConfirmDialog
        open={confirmingRemove}
        destructive
        title="Remover bloco?"
        description="O bloco sai do relatório. Você ainda pode cancelar a edição para desfazer tudo."
        confirmText="Remover"
        onConfirm={() => {
          setConfirmingRemove(false);
          onRemove();
        }}
        onCancel={() => setConfirmingRemove(false)}
        dataTestId={`${testId}-remove-confirm`}
      />
    </ReportGridItem>
  );
}
