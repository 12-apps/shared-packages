/**
 * The reports area's one confirmation dialog (FUT-391). Destructive-ish moves —
 * archiving a report, dropping a block from the canvas — are one click away in
 * the new inline UX, so each is gated by the SAME modal with the same button
 * order; there is no second confirmation idiom to learn.
 */
import type { JSX } from "react";

import { AlertDialog } from "@12-apps/ui/data-display/AlertDialog";

import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX } from "./report-surface";

/**
 * What the reports area restates about MUI's dialog, and why each line is here.
 *
 * `AlertDialog` builds its footer from MUI's own `Button`, which uppercases its
 * label — so this one dialog shouted `CANCELAR` / `REMOVER` while every other
 * button in the product is sentence case (`visual-pass.md` §Components: "One
 * button case across the product. Sentence case."). Two button cases on one
 * screen reads as two design languages, which is failure #3 in that file.
 *
 * The title is MUI's `h6` at 20px, which made the question in a confirmation
 * larger than the PAGE TITLE behind it. It drops to the same 18px the report
 * and block titles use — it is a section heading, not the page.
 *
 * The radii come from the same two-value family as the rest of the area.
 */
const DIALOG_SX = {
  "& .MuiDialog-paper": { borderRadius: `${CONTAINER_RADIUS_PX}px` },
  "& .MuiDialogTitle-root .MuiTypography-root": { fontSize: "1.125rem", fontWeight: 600 },
  "& .MuiButton-root": {
    textTransform: "none",
    borderRadius: `${CONTROL_RADIUS_PX}px`,
    boxShadow: "none",
  },
} as const;

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  onConfirm,
  onCancel,
  dataTestId,
  destructive = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  dataTestId: string;
  /** Renders the confirm action in the danger tone (block removal). */
  destructive?: boolean;
}): JSX.Element {
  return (
    <AlertDialog
      open={open}
      variant={destructive ? "destructive" : "default"}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText="Cancelar"
      onConfirm={onConfirm}
      onCancel={onCancel}
      onClose={onCancel}
      sx={DIALOG_SX}
      data-testid={dataTestId}
    />
  );
}
