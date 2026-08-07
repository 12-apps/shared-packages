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
import type { DragReorder } from "./lib/drag-reorder";
import { ReportBlockFrame, ReportGridItem } from "./report-grid";
import { ReportRenderView } from "./report-render";
import type { ReportBlockDraft } from "./report-model";
import type { ReportRange } from "./reports-api";

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
        aria-label="Arraste para posicionar"
        title="Arraste para posicionar"
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

export function EditableBlock({
  tenantSlug,
  block,
  entities,
  range,
  dnd,
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
      <ReportBlockFrame
        dataTestId={testId}
        active={dnd.overId === block.id}
        title={
          <BlockTitleSlot block={block} dnd={dnd} testId={testId} onTitleChange={onTitleChange} />
        }
        actions={
          <BlockActions
            penRef={penRef}
            testId={testId}
            onEdit={() => setEditing(true)}
            onRemove={() => setConfirmingRemove(true)}
          />
        }
      >
        <BlockPreview tenantSlug={tenantSlug} spec={block.spec} range={range} testId={testId} />
      </ReportBlockFrame>
      {editing ? (
        // A panel, not a popover (FUT-391) — so it needs no anchor.
        <BlockEditorPanel
          key={`${block.id}-editor`}
          open
          onClose={() => setEditing(false)}
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
