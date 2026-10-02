/**
 * A dashboard block's table, opened whole (FUT-3167).
 *
 * Inside a block the table stops at about ten rows and scrolls in place
 * (`bounded-table`), which keeps the canvas a canvas. This is where the rest is
 * READ: the same rendering with no cap, in a dialog wide enough for every
 * column, and the whole screen on a phone, where a dialog's margins would give
 * back the width the table was opened to get.
 *
 * The caller renders the body. The rendering is the block's own (same rows,
 * same columns, same chart-as-table switch), so the dialog can never show a
 * table that disagrees with the block it came from.
 */
import type { JSX, ReactNode } from "react";

import { Dialog, DialogContent } from "@12-apps/ui/feedback/Dialog";
import useMediaQuery from "@12-apps/ui/mui/useMediaQuery";

/** Below this, the dialog takes the whole screen. MUI's `sm`. */
const FULL_SCREEN_BELOW_PX = 600;

export function BlockExpandDialog({
  open,
  onClose,
  title,
  description,
  dataTestId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: string;
  dataTestId: string;
  children: ReactNode;
}): JSX.Element | null {
  const fullScreen = useMediaQuery(`(max-width:${FULL_SCREEN_BELOW_PX - 1}px)`);
  if (!open) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      variant={fullScreen ? "fullscreen" : "default"}
      size="lg"
      dataTestId={dataTestId}
    >
      <DialogContent dataTestId={`${dataTestId}-content`}>{children}</DialogContent>
    </Dialog>
  );
}
