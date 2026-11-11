"use client";

import type React from "react";

import { Box } from "../../../mui/Box";
import { PinnedRowLabel, pinnedRowAccent, pinnedRowTint } from "../DataGrid/DataGrid.pinned";

/** The pinned row and the host's words for it, handed to the headerless bodies. */
export interface PinnedMark<T> {
  row: T;
  label?: string;
}

/**
 * The pinned mark, or undefined: the shape every headerless body takes, built
 * once from the controller so the three bodies cannot disagree.
 */
export function pinnedMarkOf<T>(row: T | undefined, label: string | undefined): PinnedMark<T> | undefined {
  return row === undefined ? undefined : { row, label };
}

/**
 * The pinned wrapper's paint: the fill and the accent laid OVER the entity's
 * own render, since the card paints its own surface and would hide anything
 * behind it. The veil takes no pointer events, so the card stays interactive.
 */
const PINNED_SLOT = {
  "data-pinned": true,
  sx: {
    position: "relative",
    "&::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: 1,
      pointerEvents: "none",
      backgroundColor: pinnedRowTint,
      boxShadow: pinnedRowAccent,
    },
  },
} as const;

/**
 * One record's wrapper in a card, board or list body. Not pinned, it is the
 * plain `<Box>` those bodies always rendered; pinned, it adds the veil and the
 * host's label, read just before the record.
 */
export function PinnedSlot({
  pinned,
  label,
  children,
}: {
  pinned: boolean;
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (!pinned) return <Box>{children}</Box>;
  return (
    <Box {...PINNED_SLOT}>
      <PinnedRowLabel label={label} />
      {children}
    </Box>
  );
}
