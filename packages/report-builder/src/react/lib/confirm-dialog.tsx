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
 * the largest thing on screen — above the 18px a report, a card and a block
 * title all use. It drops to that: a confirmation asks a section-sized
 * question, not a page-sized one.
 *
 * It takes BOTH selectors below, because `AlertDialog` renders the title over
 * two elements: an `<h2 class="MuiDialogTitle-root">` wrapping an icon and a
 * `<span class="MuiTypography-h6">` holding the words. The span carries its own
 * 20px, which beats anything inherited, so the descendant rule is the one that
 * sizes the text a reader sees; the outer rule sizes the heading itself, for
 * the day a variant renders its title without that span.
 *
 * The radii come from the same two-value family as the rest of the area —
 * including the header's close control, which arrives as a circle and was the
 * only `50%` left in the reports screens.
 */
const DIALOG_SX = {
  "& .MuiDialog-paper": { borderRadius: `${CONTAINER_RADIUS_PX}px` },
  "& .MuiDialogTitle-root, & .MuiDialogTitle-root .MuiTypography-root": {
    fontSize: "1.125rem",
    fontWeight: 600,
  },
  "& .MuiButton-root": {
    textTransform: "none",
    borderRadius: `${CONTROL_RADIUS_PX}px`,
    boxShadow: "none",
  },
  "& .MuiIconButton-root": { borderRadius: `${CONTROL_RADIUS_PX}px` },
} as const;

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  dataTestId,
  destructive = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  /**
   * The dismiss label, beside {@link confirmText}. REQUIRED and symmetric with
   * it: this is a leaf a host can mount standalone, and a default in one
   * language is how the next adopter inherits ours (FUT-760).
   */
  cancelText: string;
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
      cancelText={cancelText}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onClose={onCancel}
      sx={DIALOG_SX}
      data-testid={dataTestId}
    />
  );
}
