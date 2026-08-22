import type { ConfirmActionCopy } from "../../../copy";
import type { ComponentType, ReactNode } from 'react';

/**
 * How much the confirmation should shout. `destructive` paints the dialog and
 * its confirm button in the error colour and moves the initial focus onto
 * Cancel, so a stray Enter cannot complete a delete.
 */
export type ConfirmTone = 'destructive' | 'default';

/** Which button owns focus when the dialog opens. */
export type ConfirmInitialFocus = 'confirm' | 'cancel';

/**
 * Everything the confirmation popup needs to say. `title` and `confirmText` are
 * required on purpose: a confirm whose button reads "OK" tells the operator
 * nothing about what is about to happen, so the verb is never defaulted.
 */
export interface ConfirmOptions {
  /** The question, e.g. `Excluir a categoria?`. */
  title: string;
  /**
   * The consequence, in the operator's words. Prefer saying whether the action
   * can be undone — the recycle bin recovers a soft delete, nothing recovers a
   * purge. Falls back to a neutral sentence built from `entityName`.
   */
  description?: ReactNode;
  /** The specific row being acted on, echoed into the dialog so it names a thing. */
  entityName?: string;
  /** The confirm button's label. Use the VERB ("Excluir"), never "OK". */
  confirmText: string;
  /** The cancel button's label. Defaults to `Cancelar`. */
  cancelText?: string;
  /**
   * When set, the confirm button stays disabled until the operator types this
   * exact string. For the handful of actions with no recovery path at all
   * (permanent purge, suspending a live store), a click is too cheap.
   */
  typeToConfirm?: string;
  /** Label above the type-to-confirm field. Defaults to a sentence naming the text. */
  typeToConfirmLabel?: string;
  /** Defaults to `destructive` — this component exists for destructive actions. */
  tone?: ConfirmTone;
  /** Defaults to `cancel` for the destructive tone, `confirm` otherwise. */
  initialFocus?: ConfirmInitialFocus;
  /** Shown inside the dialog when the action rejects; the dialog stays open. */
  /** Root test id; the dialog's parts derive theirs from it. */
  dataTestId?: string;
}

/**
 * The action being guarded. A returned promise keeps the dialog open in its
 * pending state until it settles, so the operator sees the write finish and
 * cannot fire it twice.
 *
 * It takes no arguments deliberately: the click that opened the popup is long
 * over by the time the operator confirms, and holding its synthetic event
 * across that gap hands the handler a target that may no longer be in the
 * document.
 */
export type ConfirmHandler = () => void | Promise<unknown>;

/** The confirmation state machine returned by `useConfirmAction`. */
export interface UseConfirmActionResult {
  /** True while the popup is open. */
  open: boolean;
  /** True while the confirmed action is in flight. */
  pending: boolean;
  /** The failure message from the last attempt, or null. */
  error: string | null;
  /** Open the popup (this is what the trigger's click does). */
  request: () => void;
  /** Dismiss without running anything. No-op while pending. */
  cancel: () => void;
  /** Run the guarded action. No-op while pending. */
  confirm: () => void;
}

/**
 * `<ConfirmAction>`'s props: the options, the guarded action, and a render prop
 * for the trigger. The render prop receives the opener so any element can be
 * the trigger — a button, a menu item, an icon.
 */
export interface ConfirmActionProps extends ConfirmOptions {
  /**
   * What the operator is told when the action fails and the cause carries no
   * message. REQUIRED since FUT-760 — it used to default to this package's own
   * pt-BR, so a host that passed nothing shipped one product's Portuguese.
   */
  errorText: string;
  /** The fallback body when no entity is named. REQUIRED — see `errorText`. */
  copy: ConfirmActionCopy;
  onConfirm: ConfirmHandler;
  children: (request: () => void, state: { pending: boolean }) => ReactNode;
}

/**
 * The minimum a component must accept to be wrappable by `withConfirmation`:
 * some click handler. The signature is deliberately at its widest so that any
 * button-shaped component qualifies — `MouseEventHandler<HTMLButtonElement>`,
 * `MouseEventHandler<HTMLAnchorElement>` and a bare `() => void` all satisfy it,
 * where naming one concrete element type would exclude the others.
 */
export interface ConfirmableProps {
  onClick?: (...args: never[]) => unknown;
}

/**
 * The prop `withConfirmation` adds to the wrapped component. Pass the options
 * to guard the click; pass `false` (or nothing, when the HOC has no defaults)
 * to fall through to the plain component — the escape hatch for the same button
 * used in a context where the action is harmless.
 */
export interface WithConfirmationProps {
  confirm?: Partial<ConfirmOptions> | false;
}

/** The component `withConfirmation` returns. */
export type ConfirmableComponent<P> = ComponentType<P & WithConfirmationProps>;
