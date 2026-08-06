/**
 * The editor's canvas (FUT-391): the report's blocks on the SAME 12-column grid
 * the viewer uses, each one inline-editable, plus the placeholder cell that
 * adds the next block exactly where it will appear.
 *
 * Drag-and-drop is placement, not a list reorder in disguise: dropping block A
 * on block B puts A in B's slot on the canvas, so what the author drags is what
 * the reader gets.
 */
import { useState, type JSX } from "react";

import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_GRID_COLUMNS } from "../layout";
import { blockTemplateGroups, type BlockTemplate } from "../server/block-templates";
import { BlockTemplatePicker } from "./block-template-picker";
import type { ReportEntityFields } from "./custom-reports-api";
import { PlusIcon } from "./lib/block-icons";
import { useDragReorder } from "./lib/drag-reorder";
import { ReportGrid, ReportGridItem } from "./report-grid";
import { EditableBlock } from "./report-editor-block";
import {
  addBlock,
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
  const dnd = useDragReorder((sourceId, targetId) =>
    onChange((current) => reorderBlock(current, sourceId, targetId)),
  );
  const full = draft.blocks.length >= REPORT_MAX_BLOCKS;
  const first = entities[0];

  return (
    <ReportGrid dataTestId="report-editor-grid">
      {draft.blocks.map((block) => (
        <EditableBlock
          key={block.id}
          tenantSlug={tenantSlug}
          block={block}
          entities={entities}
          range={range}
          dnd={dnd}
          onTitleChange={(title) =>
            onChange((current) => updateBlock(current, block.id, { title }))
          }
          onSpanChange={(span) => onChange((current) => updateBlock(current, block.id, { span }))}
          onSpecChange={(spec) => onChange((current) => updateBlockSpec(current, block.id, spec))}
          onRemove={() => onChange((current) => removeBlock(current, block.id))}
        />
      ))}
      <AddBlockRow disabled={full || !first} onAdd={() => setPicking(true)} />
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
    </ReportGrid>
  );
}
