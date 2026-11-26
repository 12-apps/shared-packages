import type { ReactNode } from 'react';

/**
 * An irreversible act asked about IN PLACE — inside the list row it acts on,
 * never over the page. Every word is the host's: the component writes none.
 *
 * The content follows the explaining-confirmation shape: the act as a
 * question (`title`), what will happen (`description`), what cannot be taken
 * back said on its own (`irreversibleNote`), the act's own verb as the one
 * destructive button (`confirmText`) and a way out (`cancelText`).
 */
export interface InlineConfirmProps {
  /** Whether the confirmation is drawn. Closed, it renders nothing. */
  open: boolean;
  /** The act as a question — "Remover Joaquim da fila?". */
  title: ReactNode;
  /** What happens, in the reader's words. */
  description?: ReactNode;
  /** What cannot be undone, set apart from `description` — "Não dá para desfazer.". */
  irreversibleNote?: ReactNode;
  /** The act's own verb, on the destructive button — never "OK". */
  confirmText: string;
  /** The way out — "Manter", "Cancelar". */
  cancelText: string;
  /**
   * The act. A returned promise holds the confirmation pending (both buttons
   * inert, Escape ignored) and a second confirm in that window is dropped. A
   * rejection keeps it open with the rejection's message, else `errorText`.
   */
  onConfirm: () => void | Promise<unknown>;
  /** The reader backed out — the cancel button or Escape. Focus goes back to where it was before opening. */
  onCancel: () => void;
  /** Said when `onConfirm` rejects with no message of its own. */
  errorText?: string;
  /** Root test id; the buttons take `-confirm`, `-cancel`, the failure `-error`. */
  dataTestId?: string;
}
