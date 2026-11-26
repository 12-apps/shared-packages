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
   * rejection keeps it open with the rejection's message, else `errorText`,
   * announced, with focus on the verb so Enter tries again.
   */
  onConfirm: () => void | Promise<unknown>;
  /**
   * The reader backed out — the cancel button or Escape. The host closes the
   * confirmation (`open={false}`); on that commit focus goes back to
   * `returnFocusTo()`, else to the element that had it when the confirmation
   * opened, if it is still in the page.
   */
  onCancel: () => void;
  /**
   * Where focus goes back after a cancel, read on the commit that closes the
   * confirmation. REQUIRED in practice when the host hides its trigger while
   * the confirmation is open: the trigger is unmounted then, and only this can
   * reach the one rendered again.
   */
  returnFocusTo?: () => HTMLElement | null;
  /** Said when `onConfirm` rejects with no message of its own. */
  errorText?: string;
  /** Root test id; the buttons take `-confirm`, `-cancel`, the failure `-error`. */
  dataTestId?: string;
}
