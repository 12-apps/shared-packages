/**
 * The canvas's furniture: everything on it that is not a block.
 *
 * The add strip, the live region a reorder speaks through, and the ONE
 * confirmation that guards removal. They live beside the canvas rather than in
 * it because the canvas file is at the size gate's ceiling, and because each of
 * these is a self-contained piece of chrome with no state of its own.
 */
import type { JSX } from "react";

import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_GRID_COLUMNS } from "../layout";
import { PlusIcon } from "./lib/block-icons";
import { ConfirmDialog } from "./lib/confirm-dialog";
import { ReportGridItem } from "./report-grid";
import { REPORT_MAX_BLOCKS } from "./report-model";

/**
 * The add affordance: a full-row dashed strip closing the canvas, with a large
 * ⊕ centred in it. A whole row (never a block-sized cell) because it is not a
 * block — it is the seam where the next one lands, and it should read as one
 * at any width.
 */
export function AddBlockRow({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}): JSX.Element {
  return (
    <ReportGridItem span={REPORT_GRID_COLUMNS} dataTestId="report-editor-add-cell">
      <Card variant="outlined" sx={{ borderStyle: "dashed", p: 0, overflow: "hidden" }}>
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
export function CanvasLiveRegion({ text }: { text: string }): JSX.Element {
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

/**
 * The removal confirmation — ONE dialog for the block's 🗑 and the
 * configuration panel's *Remover* (GAP 6).
 *
 * Its test id stays keyed by the block, which is what the origin host's e2e drives;
 * with no target it still has to render something addressable, so it falls
 * back to a name no block can have.
 */
export function RemoveBlockConfirm({
  targetId,
  onConfirm,
  onCancel,
}: {
  /** The block awaiting confirmation, or `null` when the dialog is closed. */
  targetId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <ConfirmDialog
      open={targetId !== null}
      destructive
      title="Remover bloco?"
      description="O bloco sai do relatório. Você ainda pode cancelar a edição para desfazer tudo."
      confirmText="Remover"
      onConfirm={onConfirm}
      onCancel={onCancel}
      dataTestId={`report-block-${targetId ?? "sem-selecao"}-remove-confirm`}
    />
  );
}
