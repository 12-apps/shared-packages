"use client";

import { createContext, Fragment, useRef, useState, type JSX, type ReactNode } from "react";

import { AlertDialog } from "@12-apps/ui/data-display/AlertDialog";
import { UsableModal } from "@12-apps/ui/feedback/UsableModal";
import { Box } from "@12-apps/ui/mui/Box";

import type { CompleteDiscountsWebCopy } from "./copy";

/**
 * The surface the create and edit forms open in (FUT-4417): a stacked modal on
 * a computer, a bottom sheet on a phone (`UsableModal`).
 *
 * `size="wide"` — the panel the library keeps for a dense two-column editor —
 * because the combo form lays out "Como fica no carrinho" in its own column
 * beside the fields when the form has the room (`asideMinPx`), and
 * the 800 px dialog it replaced never had it. The owner's call, 2026-11-05:
 * "Substitui o modal pelo stacked modal no desktop".
 *
 * Every opening mounts a fresh form, so it re-seeds instead of keeping the
 * last attempt's values — even when it reopens inside the modal's 400 ms way
 * out, while the closing body is still mounted (hence the key per opening).
 * The body stays mounted while it leaves, so the panel does not slide out
 * empty. The submit stays in the form: it acts on the fields above it.
 *
 * `copy.form.dialog` names the ✕ and the back arrow, which carry a glyph only;
 * the arrow shows when the modal opens over another stacked panel.
 *
 * **Leaving with changes** (FUT-4478): the form reports whether it is dirty
 * through `DirtyReportContext`, and the modal's ONE `onClose` — the ✕, the
 * veil, Esc and the sheet's back — asks "Sair sem salvar?" while it is; clean,
 * it closes at once. Discounts keep no draft (owner, 2026-11-06), so the
 * question is the whole guard. A discard closes silently.
 */
export function DiscountDialog({
  open,
  onClose,
  title,
  copy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  copy: CompleteDiscountsWebCopy;
  children: ReactNode;
}): JSX.Element {
  const [opening, setOpening] = useState(open ? 1 : 0);
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);
  const close = (): void => {
    if (dirty.current) setAsking(true);
    else onClose();
  };
  const { chrome } = copy.steps;
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening(opening + 1);
    dirty.current = false;
  }
  return (
    <DirtyReportContext.Provider value={(next) => (dirty.current = next)}>
    <UsableModal
      open={open}
      onClose={close}
      title={title}
      size="wide"
      closeLabel={copy.form.dialog.close}
      backLabel={copy.form.dialog.back}
      dataTestId="discount-dialog"
    >
      {/* `clip`, not `hidden`: a checked switch's hit area reaches 24 px past
          its track (the input is three tracks wide), which the sheet's 16 px
          gutter turned into an 8 px sideways scroll of the whole form. Clipping
          keeps that overflow out of the scroller without making a second one. */}
      <Box sx={{ minWidth: 0, overflowX: "clip" }}>
        <Fragment key={opening}>{children}</Fragment>
      </Box>
    </UsableModal>
    <AlertDialog
      open={asking}
      title={chrome.leaveTitle}
      description={chrome.leaveBody}
      confirmText={chrome.leaveStay}
      cancelText={chrome.leaveDiscard}
      closeLabel={copy.form.dialog.close}
      initialFocus="confirm"
      emphasis="confirm"
      onConfirm={() => setAsking(false)}
      onCancel={() => {
        setAsking(false);
        dirty.current = false;
        onClose();
      }}
      onClose={() => setAsking(false)}
      data-testid="discount-leave-confirm"
    />
    </DirtyReportContext.Provider>
  );
}

/** Where a form inside `DiscountDialog` says whether it has unsaved changes. */
export const DirtyReportContext = createContext<((dirty: boolean) => void) | null>(null);
