"use client";

import { createContext, useContext, type ReactNode } from "react";

import { Box } from "../../../mui/Box";

/**
 * DRAGGING, OWNED BY THE CONTAINER AND NOT BY THE CARD.
 *
 * A card cannot know whether it is draggable. The same `BaseListCard` renders
 * inside a reorderable queue, a read-only report and a board column that moves
 * items between columns — and only the thing holding them knows which. So the
 * container publishes a drag context and every card inside it becomes
 * draggable; a card with no container above it renders exactly as before, with
 * no handle and no listeners.
 *
 * This is a SEAM, not a drag implementation. It carries whatever props the
 * host's library hands out — dnd-kit's `attributes`/`listeners`, react-dnd's
 * connector output, or plain HTML5 `draggable` + `onDragStart` — because
 * picking one of those for every consumer of `@12-apps/ui` is a decision this
 * package has no business making. There is no drag dependency here, and adding
 * one would force it on every app that installs the library.
 */

/** The props a container hands to one item. Deliberately untyped-ish: each DnD library has its own shape. */
export type DragItemProps = Record<string, unknown>;

export interface DragContainerValue {
  /**
   * Props for the item's ROOT — the element that moves. dnd-kit wants its
   * `setNodeRef` and transform style here; HTML5 wants `draggable` and
   * `onDragStart`.
   */
  itemProps: (id: string | number) => DragItemProps;
  /**
   * Props for the HANDLE alone, when the container wants drags to start only
   * from the grip.
   *
   * Whole-card dragging breaks the two things a card must still do: selecting
   * text in it, and hitting the checkbox without the row sliding away. When a
   * container returns handle props, the card puts them on the grip and leaves
   * the rest of itself alone.
   */
  handleProps?: (id: string | number) => DragItemProps;
  /** The id currently being dragged, so its card can dim itself. */
  activeId?: string | number | null;
  /**
   * WHERE THE DRAGGED ITEM WOULD LAND — the one thing a drag cannot be honest
   * without.
   *
   * A list that dims the row you picked up and shows nothing else asks you to
   * guess the outcome and find out by dropping. The marker turns that into a
   * statement: THIS gap is where it goes.
   *
   * Published by the container, not computed by the card, for the same reason
   * everything else here is: only the thing holding the items knows the
   * geometry — which one you are over, which edge of it, and whether that
   * position is legal. A card knows none of that about its neighbours.
   *
   * `null` while nothing is being dragged, or while the pointer is over no
   * valid target.
   */
  dropIndicator?: { id: string | number; edge: "before" | "after" } | null;
}

const DragContainerContext = createContext<DragContainerValue | null>(null);

/**
 * Marks everything inside as draggable. Cards read this; nothing else does.
 */
export function DragContainerProvider({
  value,
  children,
}: {
  value: DragContainerValue;
  children: ReactNode;
}): React.JSX.Element {
  return <DragContainerContext.Provider value={value}>{children}</DragContainerContext.Provider>;
}

/**
 * What one card needs to know about dragging.
 *
 * Returns the inert answer when there is no container OR no `dragId` — a card
 * that forgot its id must not render a handle that does nothing, which is worse
 * than no handle at all.
 */
export function useDragItem(dragId: string | number | undefined): {
  draggable: boolean;
  itemProps: DragItemProps;
  handleProps: DragItemProps | undefined;
  dragging: boolean;
  /** Which of this card's edges the marker sits on, or null for neither. */
  dropEdge: "before" | "after" | null;
} {
  const container = useContext(DragContainerContext);
  if (!container || dragId === undefined) {
    return { draggable: false, itemProps: {}, handleProps: undefined, dragging: false, dropEdge: null };
  }
  const indicator = container.dropIndicator;
  return {
    draggable: true,
    itemProps: container.itemProps(dragId),
    handleProps: container.handleProps?.(dragId),
    dragging: container.activeId === dragId,
    dropEdge: indicator != null && indicator.id === dragId ? indicator.edge : null,
  };
}

/**
 * THE DROP MARKER — one rule across the card's edge, drawn where the item lands.
 *
 * Shared by every draggable surface rather than reimplemented per card, so a
 * reorderable list, a board column and a grid of tiles all say the same thing
 * the same way. A consumer wiring its own DnD gets this for free by publishing
 * `dropIndicator`; it never draws the marker itself.
 *
 * ABSOLUTE, AND OUTSIDE THE FLOW ON PURPOSE. A marker that took layout space
 * would push every row below it down by its own height the moment it appeared —
 * the list would twitch as you dragged across it, and the gap you were aiming
 * at would move out from under the pointer. Drawn over the gap instead, nothing
 * reflows.
 *
 * `pointerEvents: none` so it cannot swallow the dragover events that placed it,
 * and `aria-hidden` because the position it reports belongs in a live region the
 * LIST owns — fifty rows each announcing a marker is a screen-reader nightmare.
 */
export function DropIndicator({ edge }: { edge: "before" | "after" }): React.JSX.Element {
  return (
    <Box
      aria-hidden
      data-slot="drop-indicator"
      data-drop-edge={edge}
      sx={{
        position: "absolute",
        left: 0,
        right: 0,
        // Centred ON the gap rather than inside the card: the item lands
        // BETWEEN two rows, and a rule sitting within one of them reads as
        // "into this row" instead.
        ...(edge === "before" ? { top: -2 } : { bottom: -2 }),
        height: 3,
        borderRadius: 2,
        bgcolor: "primary.main",
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  );
}

/**
 * The grip. Six dots, the convention everywhere, drawn rather than imported so
 * this costs no icon dependency.
 *
 * `cursor: grab` on the handle only when the container gates drags to it —
 * otherwise the whole card carries the cursor and the handle is just an
 * affordance saying so.
 */
export function DragHandle({
  handleProps,
  gated,
  testId,
}: {
  handleProps: DragItemProps | undefined;
  gated: boolean;
  testId?: string;
}): React.JSX.Element {
  return (
    <Box
      component="span"
      aria-hidden={handleProps ? undefined : true}
      data-testid={testId}
      {...handleProps}
      sx={{
        display: "inline-grid",
        gridTemplateColumns: "repeat(2, 3px)",
        gap: "2px",
        flexShrink: 0,
        p: 0.5,
        borderRadius: 1,
        color: "text.disabled",
        cursor: gated ? "grab" : "inherit",
        touchAction: "none",
        "&:active": { cursor: gated ? "grabbing" : "inherit" },
        "&:hover": { color: "text.secondary" },
      }}
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <Box
          key={index}
          component="span"
          sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "currentColor" }}
        />
      ))}
    </Box>
  );
}
