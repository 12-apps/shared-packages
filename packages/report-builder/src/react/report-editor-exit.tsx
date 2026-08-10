/**
 * What leaving the editor costs, and the one moment it is worth saying
 * (FUT-755).
 *
 * Deliberately NOT "you will lose your changes". Edits are autosaved, so the
 * work survives either way — what leaving costs is the AUDIENCE. On a
 * published report the store keeps reading the version from before this
 * sitting; on a draft nobody can read it at all. Those are two different
 * facts, and collapsing them into one convenient sentence would make the
 * warning wrong in whichever case it was not written for.
 *
 * With nothing pending it says nothing. A confirmation that fires when there
 * is nothing to confirm is one people learn to dismiss without reading, which
 * costs you the times it mattered.
 */
import type { JSX } from "react";

import { ConfirmDialog } from "./lib/confirm-dialog";
import type { PublishDraft } from "./lib/publish-section";

/**
 * True when leaving would leave something behind worth naming.
 *
 * `dirty` is work the autosave timer has not flushed — or an autosave that
 * FAILED, since the baseline only moves on success, which is exactly when a
 * warning earns its place. `unpublished` is work that IS stored but that no
 * reader has been shown.
 */
export function hasPendingWork(dirty: boolean, unpublished: boolean): boolean {
  return dirty || unpublished;
}

export function ExitConfirmDialog({
  open,
  publish,
  onLeave,
  onStay,
}: {
  open: boolean;
  publish: PublishDraft;
  onLeave: () => void;
  onStay: () => void;
}): JSX.Element {
  const published = publish.status === "published";
  return (
    <ConfirmDialog
      open={open}
      title="Sair sem publicar?"
      description={
        published
          ? "Suas alterações estão guardadas, mas ainda não foram publicadas. Quem abre o relatório continua vendo a versão publicada até você salvar."
          : "Suas alterações estão guardadas, mas o relatório ainda não foi publicado. Ninguém mais vê estas alterações até você salvar."
      }
      confirmText="Sair sem publicar"
      onConfirm={onLeave}
      onCancel={onStay}
      dataTestId="report-editor-exit-confirm"
    />
  );
}
