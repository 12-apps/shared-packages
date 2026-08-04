/**
 * The reports area's one confirmation dialog (FUT-391). Destructive-ish moves —
 * archiving a report, dropping a block from the canvas — are one click away in
 * the new inline UX, so each is gated by the SAME modal with the same button
 * order; there is no second confirmation idiom to learn.
 */
import type { JSX } from "react";

import { AlertDialog } from "@12-apps/ui/data-display/AlertDialog";

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
      data-testid={dataTestId}
    />
  );
}
