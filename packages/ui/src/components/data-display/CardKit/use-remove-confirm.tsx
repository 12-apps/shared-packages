'use client';

import type { JSX } from 'react';

import { ConfirmActionDialog, useConfirmAction } from '../../feedback/ConfirmAction';

import { useCardActions } from './card-actions-context';

/** The `{ ok, error }` envelope a write action answers with. */
export interface CardWriteResult {
  ok: boolean;
  error?: string;
}

interface RemoveConfirmOptions {
  /** The destructive write. Called ONLY after the operator confirms. */
  write: () => Promise<CardWriteResult>;
  /** The popup's question. */
  title: string;
  /** The row being removed, echoed into the popup so it names a thing. */
  entityName: string;
  /**
   * What happens, and whether it can be walked back. Say which — the difference
   * between a soft delete a recycle bin recovers and one nothing recovers is
   * the whole content of the decision being asked for.
   */
  description: string;
  /** The confirm button's VERB. Required, never defaulted. */
  confirmText: string;
  /** Used when the write fails without a message of its own. */
  fallbackError: string;
  dataTestId: string;
}

interface RemoveConfirm {
  /** Hand this to the menu item's `onClick`: it opens the popup, nothing more. */
  request: () => void;
  /** Render alongside the trigger. */
  dialog: JSX.Element;
}

/**
 * The confirm-before-removing wiring every card/row menu repeats, in one place.
 *
 * It closes the three gaps a hand-rolled version keeps re-opening: the write
 * leaves ONLY on confirm; a refusal is surfaced twice — inside the popup, where
 * the operator is still deciding, and in the shared snackbar behind it — and a
 * failed attempt leaves the popup OPEN to be retried instead of vanishing over
 * a delete that never happened.
 *
 * The difference from {@link useRowConfirm} is which surface it serves: this one
 * is for a SELF-CONTAINED menu that already sits inside a
 * `CardActionsProvider`, so it reads the refresh and the error channel from
 * context and answers the `{ ok, error }` envelope those actions use.
 * `useRowConfirm` is for a grid whose actions are declared as `RowAction[]` and
 * act on a selection.
 *
 * ```tsx
 * const remove = useRemoveConfirm({
 *   write: () => deleteCategory({ tenantSlug, id: row.id }),
 *   title: copy.deleteTitle,
 *   entityName: row.name,
 *   description: copy.deleteDescription,
 *   confirmText: copy.delete,
 *   fallbackError: copy.deleteFailed,
 *   dataTestId: 'category-delete-confirm',
 * });
 * ```
 */
export function useRemoveConfirm({
  write,
  title,
  entityName,
  description,
  confirmText,
  fallbackError,
  dataTestId,
}: RemoveConfirmOptions): RemoveConfirm {
  const { onRefresh, notifyError } = useCardActions();

  const state = useConfirmAction(async () => {
    const result = await write();
    if (!result.ok) {
      const message = result.error ?? fallbackError;
      notifyError(message);
      // Rejecting is what keeps the popup open carrying `message`; the snackbar
      // above is what remains once the operator dismisses it.
      throw new Error(message);
    }
    onRefresh();
  }, fallbackError);

  return {
    request: state.request,
    dialog: (
      <ConfirmActionDialog
        state={state}
        title={title}
        entityName={entityName}
        description={description}
        confirmText={confirmText}
        dataTestId={dataTestId}
      />
    ),
  };
}
