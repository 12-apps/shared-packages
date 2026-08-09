/**
 * Reordering a list of blocks — BOTH ways it can be done.
 *
 * `useDragReorder` is the pointer path (FUT-311). No library: a drag HANDLE
 * starts the drag carrying the item id, every row is a drop target, and the
 * caller applies the reorder with a pure model helper.
 *
 * `useKeyboardReorder` is the other path (FUT-755). This header used to claim
 * that "keyboard and touch users keep the existing up/down buttons" — there
 * were none, anywhere in `src/react`, so reordering was pointer-only and a
 * WCAG 2.1.1 failure. Alt+↑/↓ on a focused block now moves it one position,
 * keeps focus on the block that moved, and says so in a polite live region.
 *
 * Why hand-rolled rather than `@dnd-kit`: `decisions/0001-drag-implementation.md`.
 */
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

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

/**
 * One reorderable block, as the keyboard path needs to know it. Not exported:
 * callers build the array inline and only `useKeyboardReorder` names the shape,
 * so exporting it is an unused public surface the knip gate rejects.
 */
interface ReorderItem {
  id: string;
  /** What the live region calls it — the block's name, spoken. */
  label: string;
}

export interface KeyboardReorder {
  /**
   * The polite live region's text: the last move, or `""` before the first
   * one. The caller renders it ONCE, visually hidden, next to the list.
   */
  announcement: string;
  /**
   * Spread on block `id`'s container. It becomes a tab stop that Alt+↑/↓
   * moves, and registers the element so focus can be put back on it once the
   * move has re-rendered the list.
   */
  blockProps: (id: string) => {
    tabIndex: 0;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    ref: (node: HTMLElement | null) => void;
  };
  /**
   * The SAME move Alt+↑/↓ performs — announcement, focus restore and boundary
   * no-op included — for a caller with no key press to react to.
   *
   * The block menu's "Mover para cima" / "Mover para baixo" (the `@drag
   * @mobile` scenario: "a long drag past sticky chrome is impractical
   * one-handed") call this rather than `moveBlock` directly. Reaching for the
   * model helper would move the block and say nothing, so the two paths would
   * differ in exactly the way that matters to the people the menu is for.
   */
  move: (id: string, delta: -1 | 1) => void;
  /** Whether that move would land anywhere — the menu greys out the ends. */
  canMove: (id: string, delta: -1 | 1) => boolean;
}

/** Which way Alt + this arrow moves a block, or null for a chord we do not own. */
function arrowDelta(event: KeyboardEvent<HTMLElement>): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === "ArrowUp") return -1;
  if (event.key === "ArrowDown") return 1;
  return null;
}

/**
 * The keyboard path to reordering (FUT-755): Alt+↑/↓ on a focused block.
 *
 * `items` is the list AS RENDERED — position is read from it, so the hook
 * needs no index arithmetic of its own and cannot disagree with what is on
 * screen about where a block currently is.
 */
export function useKeyboardReorder({
  items,
  onMove,
}: {
  items: readonly ReorderItem[];
  onMove: (id: string, delta: -1 | 1) => void;
}): KeyboardReorder {
  const [announcement, setAnnouncement] = useState("");
  const nodes = useRef(new Map<string, HTMLElement>());
  // Written by a move, consumed by the effect below. Focus cannot be restored
  // inside the handler that asks for the move: the block is only back in its
  // new place after React has committed, and re-inserting the element THERE is
  // what dropped the focus in the first place — a browser blurs a node that is
  // moved with `insertBefore`.
  const refocus = useRef<string | null>(null);

  // Layout, not passive: this runs in the same frame as the move, so focus is
  // never observably on `<body>`. A passive effect restores it a paint later,
  // which is a real blur/focus round trip for a screen reader to narrate.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    nodes.current.get(id)?.focus({ preventScroll: true });
  });

  // Off either end is a NO-OP, deliberately: nothing moves, nothing is
  // announced, and `onMove` is never called — so Alt+↓ on the last block
  // cannot leave the report claiming unsaved changes it does not have.
  function canMove(id: string, delta: -1 | 1): boolean {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0) return false;
    const to = from + delta;
    return to >= 0 && to < items.length;
  }

  function move(id: string, delta: -1 | 1): void {
    if (!canMove(id, delta)) return;
    const from = items.findIndex((item) => item.id === id);
    const item = items[from];
    if (!item) return;
    onMove(id, delta);
    refocus.current = id;
    setAnnouncement(`${item.label} movido para a posição ${from + delta + 1} de ${items.length}`);
  }

  return {
    announcement,
    move,
    canMove,
    blockProps: (id) => ({
      tabIndex: 0,
      onKeyDown: (event) => {
        const delta = arrowDelta(event);
        if (delta === null) return;
        // Claimed whether or not it moves: at the ends the chord is still
        // ours, and letting it through would scroll the page instead.
        event.preventDefault();
        move(id, delta);
      },
      ref: (node) => {
        if (node) nodes.current.set(id, node);
        else nodes.current.delete(id);
      },
    }),
  };
}
