'use client';

import { useState, type JSX } from 'react';

import { ConfirmActionDialog, useConfirmAction } from '../../feedback/ConfirmAction';

/**
 * How the popup should read for the rows about to be acted on.
 *
 * Built from the SELECTION rather than from a single row, because the same
 * guard covers a bulk action: "Delete 4 categories?" and "Delete the category
 * Drinks?" are the same question asked of a different-sized selection — and an
 * operator who multi-selected by mistake is exactly who this popup is for.
 */
export interface RowConfirmCopy {
  title: string;
  description: string;
  /** Echoed into the popup; omit for a multi-row selection the title covers. */
  entityName?: string;
  /** The VERB. Required, never defaulted — see {@link useRowConfirm}. */
  confirmText: string;
  /** Override where the word "cancel" would mean the ACTION itself. */
  cancelText?: string;
  /** Require typing this before the confirm enables — for the unrecoverable few. */
  typeToConfirm?: string;
}

interface RowConfirmOptions<T> {
  /**
   * The destructive write, over the whole selection. Called ONLY after the
   * operator confirms; throw (or reject) to keep the popup open carrying the
   * message.
   */
  write: (rows: T[]) => Promise<unknown>;
  /** The wording, given the selection. */
  describe: (rows: T[]) => RowConfirmCopy;
  dataTestId: string;
  /** Shown when `write` fails without a message of its own. */
  errorText?: string;
}

export interface RowConfirm<T> {
  /** Hand this a grid action's `rows`: it opens the popup and writes nothing. */
  request: (rows: T[]) => void;
  /** Render next to the grid. */
  dialog: JSX.Element | null;
}

/**
 * Confirmation for a grid's `RowAction` — the per-row kebab entry and the
 * multi-select actions menu both, since they run the same handler.
 *
 * The SELECTION is held while the popup is open, so the write sees exactly the
 * rows the operator was looking at when they were asked. Re-reading the grid's
 * live selection at confirm time is the bug this shape avoids: the list can
 * refresh underneath an open dialog.
 *
 * `confirmText` is required and comes from `describe`, with no default. A verb
 * defaulted in the origin's language reads as finished to the next adopter
 * right up until an operator sees it — and `ConfirmOptions` already refuses to
 * default one for the same reason.
 */
export function useRowConfirm<T>({
  write,
  describe,
  dataTestId,
  errorText,
}: RowConfirmOptions<T>): RowConfirm<T> {
  const [target, setTarget] = useState<T[] | null>(null);

  const state = useConfirmAction(async () => {
    if (!target) return;
    await write(target);
    setTarget(null);
  }, errorText);

  const request = (rows: T[]): void => {
    // An empty selection has nothing to confirm — asking would be a popup about
    // nothing, and confirming it would write nothing.
    if (rows.length === 0) return;
    setTarget(rows);
    state.request();
  };

  return {
    request,
    dialog: target ? (
      <ConfirmActionDialog state={state} {...describe(target)} dataTestId={dataTestId} />
    ) : null,
  };
}
