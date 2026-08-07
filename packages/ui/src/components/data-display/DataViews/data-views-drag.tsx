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
} {
  const container = useContext(DragContainerContext);
  if (!container || dragId === undefined) {
    return { draggable: false, itemProps: {}, handleProps: undefined, dragging: false };
  }
  return {
    draggable: true,
    itemProps: container.itemProps(dragId),
    handleProps: container.handleProps?.(dragId),
    dragging: container.activeId === dragId,
  };
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
