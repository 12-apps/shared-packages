/**
 * The canvas's ONE configuration panel (FUT-755) — the whole point of lifting
 * selection out of the blocks.
 *
 * It lives in its own module because the canvas is at the size gate's ceiling
 * and this is the piece that can leave without splitting an idea in half: the
 * canvas owns WHICH block is selected, and this owns what the panel does with
 * it.
 */
import type { JSX } from "react";

import { REPORT_GRID_COLUMNS } from "../layout";
import { BlockEditorPanel } from "./block-editor-panel";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";
import {
  REPORT_MAX_BLOCKS,
  updateBlock,
  updateBlockSpec,
  type ReportDraft,
} from "./report-model";

/** What the one panel is pointed at, flattened so its JSX has no branches. */
interface PanelTarget {
  /** Remount key: a new block re-seeds the form and resets its scroll. */
  key: string;
  spec: ReportSpecWire | null;
  span: number;
  /** The block's height tier, or `undefined` for its own content height. */
  height: number | undefined;
  /** The block's own title, or "" in the empty state. */
  title: string;
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
      height: undefined,
      title: "",
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
    height: block.height,
    title: block.title,
    testId: `report-block-${block.id}-editor`,
    id: block.id,
  };
}

/**
 * Keyed by the selected block so switching re-seeds the form and resets its
 * scroll, while re-clicking the same block leaves both alone.
 *
 * *Duplicar* and *Remover* are handed in rather than implemented here (GAP 6).
 * Removal in particular must be the SAME path as the block's own 🗑, including
 * its confirmation — the canvas owns that dialog, so the panel can only ask.
 */
export function CanvasPanel({
  draft,
  entities,
  selectedId,
  everOpened,
  onClose,
  onChange,
  onDuplicate,
  onRemove,
}: {
  draft: ReportDraft;
  entities: ReportEntityFields[];
  selectedId: string | null;
  /** Before the first selection there is no panel at all — see the canvas. */
  everOpened: boolean;
  onClose: () => void;
  onChange: (next: (draft: ReportDraft) => ReportDraft) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}): JSX.Element | null {
  if (!everOpened) return null;

  const target = panelTarget(draft, selectedId);
  const apply = (next: (current: ReportDraft, id: string) => ReportDraft): void => {
    const id = target.id;
    if (id !== null) onChange((current) => next(current, id));
  };

  return (
    <BlockEditorPanel
      key={target.key}
      open
      onClose={onClose}
      entities={entities}
      spec={target.spec}
      span={target.span}
      height={target.height}
      title={target.title}
      onChange={(spec) => apply((current, id) => updateBlockSpec(current, id, spec))}
      onSpanChange={(span) => apply((current, id) => updateBlock(current, id, { span }))}
      onHeightChange={(height) => apply((current, id) => updateBlock(current, id, { height }))}
      onTitleChange={(title) => apply((current, id) => updateBlock(current, id, { title }))}
      onDuplicate={onDuplicate}
      // Visible-but-refused at the ceiling, rather than absent: a control that
      // vanishes at twelve blocks reads as a bug, where one that explains
      // itself reads as a limit.
      canDuplicate={draft.blocks.length < REPORT_MAX_BLOCKS}
      onRemove={onRemove}
      testId={target.testId}
    />
  );
}
