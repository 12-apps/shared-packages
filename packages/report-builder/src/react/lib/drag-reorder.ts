/**
 * Native HTML5 drag-to-reorder for vertical lists (FUT-311). No library: a
 * drag HANDLE starts the drag carrying the item id, every row is a drop
 * target, and the caller applies the reorder with a pure model helper.
 * Keyboard and touch users keep the existing up/down buttons — this only
 * adds a pointer affordance on top of them.
 */
import { useState, type DragEvent } from "react";

// A dedicated type keeps foreign drags out: dragged text or files never carry
// it, so they neither highlight rows nor trigger a reorder even when their
// text happens to match a block id.
const PAYLOAD_TYPE = "application/x-report-builder-reorder";

function isReorderDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(PAYLOAD_TYPE);
}

export interface DragReorder {
  /** Row currently hovered by an active drag — highlight it as the drop slot. */
  overId: string | null;
  /**
   * Spread on the drag handle of row `id` — the handle only, not the whole
   * row, so text inside the row's inputs stays selectable.
   */
  handleProps: (id: string) => {
    draggable: true;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  /** Spread on the row container of row `id` so it accepts drops. */
  targetProps: (id: string) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

export function useDragReorder(
  onMove: (sourceId: string, targetId: string) => void,
): DragReorder {
  const [overId, setOverId] = useState<string | null>(null);
  return {
    overId,
    handleProps: (id) => ({
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData(PAYLOAD_TYPE, id);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => setOverId(null),
    }),
    targetProps: (id) => ({
      onDragOver: (event) => {
        if (!isReorderDrag(event)) return;
        // preventDefault marks the row as a valid drop target.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOverId(id);
      },
      onDragLeave: (event) => {
        // dragleave also fires when the pointer moves onto a child of the
        // row; only clear the highlight when it actually exits the row.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOverId((current) => (current === id ? null : current));
      },
      onDrop: (event) => {
        if (!isReorderDrag(event)) return;
        event.preventDefault();
        setOverId(null);
        const sourceId = event.dataTransfer.getData(PAYLOAD_TYPE);
        if (sourceId !== "" && sourceId !== id) onMove(sourceId, id);
      },
    }),
  };
}
