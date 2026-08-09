/**
 * One block in EDIT mode (FUT-391): the exact frame the viewer draws, with its
 * chrome added inline — grip, title, ✎ and 🗑 — and its body rendered from a
 * LIVE run of the block's current spec. Chart, table and KPI all render exactly
 * as they will be read; nothing about editing degrades the rendering.
 *
 * The body is the point: adding a block or changing its query immediately
 * fetches and renders real data for the selected period, so the author is
 * laying out the actual report, not placeholders that will surprise them after
 * the first save.
 */
import { useRef, useState, type JSX, type RefObject } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";

import { BlockEditorPanel } from "./block-editor-panel";
import { useRunReport, type ReportEntityFields, type ReportSpecWire } from "./custom-reports-api";
import { GripIcon, PencilIcon, TrashIcon } from "./lib/block-icons";
import { ConfirmDialog } from "./lib/confirm-dialog";
import type { DragReorder, KeyboardReorder } from "./lib/drag-reorder";
import { ReportBlockFrame, ReportGridItem } from "./report-grid";
import { ReportRenderView } from "./report-render";
import { blockLabel, type ReportBlockDraft } from "./report-model";
import type { ReportRange } from "./reports-api";

/** Visible focus for the block group, which is a container rather than a control. */
const FOCUS_RING = {
  outline: "2px solid",
  outlineColor: "primary.main",
  outlineOffset: "2px",
} as const;

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

/** ✎ + 🗑 — the block's edit chrome, kept to two icons so it fits any width. */
function BlockActions({
  penRef,
  testId,
  onEdit,
  onRemove,
}: {
  penRef: RefObject<HTMLButtonElement | null>;
  testId: string;
  onEdit: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Button
        ref={penRef}
        variant="ghost"
        size="sm"
        aria-label="Editar bloco"
        onClick={onEdit}
        dataTestId={`${testId}-edit`}
      >
        <PencilIcon />
      </Button>
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
 * The config panel and the remove confirmation — the two things a block can
 * put on top of the canvas. They sit OUTSIDE the block's focusable group on
 * purpose: neither is part of the block for keyboard purposes, and Alt+↑/↓
 * typed inside the panel must not reorder the canvas behind it.
 */
function BlockOverlays({
  block,
  entities,
  penRef,
  testId,
  editing,
  confirmingRemove,
  onCloseEditor,
  onSpanChange,
  onSpecChange,
  onCancelRemove,
  onConfirmRemove,
}: {
  block: ReportBlockDraft;
  entities: ReportEntityFields[];
  penRef: RefObject<HTMLButtonElement | null>;
  testId: string;
  editing: boolean;
  confirmingRemove: boolean;
  onCloseEditor: () => void;
  onSpanChange: (span: number) => void;
  onSpecChange: (spec: ReportSpecWire) => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}): JSX.Element {
  return (
    <>
      {editing ? (
        // A panel, not a popover (FUT-391) — so it needs no anchor.
        <BlockEditorPanel
          key={`${block.id}-editor`}
          open
          onClose={onCloseEditor}
          restoreFocusTo={penRef}
          entities={entities}
          spec={block.spec}
          span={block.span}
          onChange={onSpecChange}
          onSpanChange={onSpanChange}
          testId={`${testId}-editor`}
        />
      ) : null}
      <ConfirmDialog
        open={confirmingRemove}
        destructive
        title="Remover bloco?"
        description="O bloco sai do relatório. Você ainda pode cancelar a edição para desfazer tudo."
        confirmText="Remover"
        onConfirm={onConfirmRemove}
        onCancel={onCancelRemove}
        dataTestId={`${testId}-remove-confirm`}
      />
    </>
  );
}

/**
 * A named, focusable group around the block's frame — and the reason it is
 * here rather than on `ReportGridItem`: the grid item is shared with the
 * viewer, and this is the tab stop the reorder shortcut needs. Without
 * something to focus, Alt+↑/↓ has nothing to be pressed on.
 */
function BlockGroup({
  tenantSlug,
  block,
  range,
  dnd,
  keyboard,
  penRef,
  testId,
  onTitleChange,
  onEdit,
  onRemove,
}: {
  tenantSlug: string;
  block: ReportBlockDraft;
  range: ReportRange;
  dnd: DragReorder;
  keyboard: KeyboardReorder;
  penRef: RefObject<HTMLButtonElement | null>;
  testId: string;
  onTitleChange: (title: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Box
      {...keyboard.blockProps(block.id)}
      role="group"
      aria-label={blockLabel(block)}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      sx={{ height: "100%", borderRadius: 1, "&:focus-visible": FOCUS_RING }}
    >
      <ReportBlockFrame
        dataTestId={testId}
        active={dnd.overId === block.id}
        title={
          <BlockTitleSlot block={block} dnd={dnd} testId={testId} onTitleChange={onTitleChange} />
        }
        actions={
          <BlockActions penRef={penRef} testId={testId} onEdit={onEdit} onRemove={onRemove} />
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
  entities,
  range,
  dnd,
  keyboard,
  onTitleChange,
  onSpanChange,
  onSpecChange,
  onRemove,
}: {
  tenantSlug: string;
  block: ReportBlockDraft;
  entities: ReportEntityFields[];
  range: ReportRange;
  dnd: DragReorder;
  /** The Alt+↑/↓ path — the block is the thing it is pressed on. */
  keyboard: KeyboardReorder;
  onTitleChange: (title: string) => void;
  onSpanChange: (span: number) => void;
  onSpecChange: (spec: ReportSpecWire) => void;
  onRemove: () => void;
}): JSX.Element {
  const testId = `report-block-${block.id}`;
  const penRef = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState(false);
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
        penRef={penRef}
        testId={testId}
        onTitleChange={onTitleChange}
        onEdit={() => setEditing(true)}
        onRemove={() => setConfirmingRemove(true)}
      />
      <BlockOverlays
        block={block}
        entities={entities}
        penRef={penRef}
        testId={testId}
        editing={editing}
        confirmingRemove={confirmingRemove}
        onCloseEditor={() => setEditing(false)}
        onSpanChange={onSpanChange}
        onSpecChange={onSpecChange}
        onCancelRemove={() => setConfirmingRemove(false)}
        onConfirmRemove={() => {
          setConfirmingRemove(false);
          onRemove();
        }}
      />
    </ReportGridItem>
  );
}
