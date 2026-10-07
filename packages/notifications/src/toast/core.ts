/**
 * TOASTS — the fourth kind of entry, and the only one that is gone in seconds.
 *
 * An inbox notification is an event kept for later; a live activity is state a
 * reader follows; attention is work waiting with a clock on it. A toast is the
 * answer to the tap that just happened — "Saved", "Could not move" —
 * and it leaves on its own unless it has to be acknowledged.
 *
 * Before this surface every host and package drew its own: a top-right card, a
 * bottom-centre snackbar, a bottom-right receipt, a tinted MUI Alert. The same
 * news landed in four corners in four looks. This module is the ONE queue; the
 * React half (`./react`) is the ONE place it is drawn — top of the screen,
 * centred, on the inverse surface.
 *
 * Framework-free on purpose: a data hook, a service worker bridge or a test can
 * raise a toast without importing React. Every sentence is the caller's; the
 * module carries no copy.
 */

/** What a toast is about. Picks the icon and the live-region politeness. */
export type ToastSeverity = 'neutral' | 'success' | 'info' | 'warning' | 'error' | 'loading';

/** The toast severities, in a stable order. */
export const TOAST_SEVERITIES: readonly ToastSeverity[] = [
  'neutral',
  'success',
  'info',
  'warning',
  'error',
  'loading',
];

/** Why a toast left. Handed to `onDismiss`, so a caller can tell a timeout from a tap. */
export type ToastDismissReason = 'timeout' | 'close' | 'action' | 'replaced' | 'api';

/** One button on a toast — "Undo", "Open", "Try again". */
export interface ToastAction {
  /** The visible word, and the button's accessible name. */
  label: string;
  onClick: () => void;
  /** Greys the button out — e.g. an undo whose write is still in flight. */
  disabled?: boolean;
  /**
   * Keep the toast up after the tap. Off by default: an action is a way out,
   * and a toast that stays after its own answer is clutter.
   */
  keepOpen?: boolean;
  testId?: string;
}

/** Everything a caller may say about a toast besides its sentence. */
export interface ToastOptions {
  /**
   * A stable identity. Raising a toast with an id already on screen REPLACES
   * that toast in place (and restarts its clock) instead of stacking a second
   * one — the shape a "last move" receipt or a retry needs.
   */
  id?: string;
  severity?: ToastSeverity;
  /** A bold lead before the sentence, e.g. which record it is about. */
  title?: string;
  actions?: readonly ToastAction[];
  /**
   * How long it stays, in ms. `null` keeps it until it is dismissed. Defaults
   * to {@link defaultToastDuration} for its severity.
   */
  duration?: number | null;
  /** Draw the close button. Default `true`; a `loading` toast should usually say `false`. */
  dismissible?: boolean;
  /**
   * Interrupt a screen reader (`role="alert"`) even though it is not an error.
   * Errors always do; everything else waits its turn in the column's polite
   * region unless it says so here.
   */
  assertive?: boolean;
  testId?: string;
  onDismiss?: (reason: ToastDismissReason) => void;
}

/** A toast as the queue holds it. */
export interface ToastItem {
  id: string;
  message: string;
  severity: ToastSeverity;
  title?: string;
  actions: readonly ToastAction[];
  duration: number | null;
  dismissible: boolean;
  assertive: boolean;
  testId?: string;
  onDismiss?: (reason: ToastDismissReason) => void;
  /** Bumped on every replace/update, so a view can restart its clock. */
  revision: number;
}

/** How long an ordinary toast stays: long enough to read a sentence twice. */
export const TOAST_DURATION_MS = 5_000;

/** An error stays longer: it is the one a reader has to act on. */
export const TOAST_ERROR_DURATION_MS = 8_000;

/** The default lifetime for a severity. `loading` waits for its promise. */
export function defaultToastDuration(severity: ToastSeverity): number | null {
  if (severity === 'loading') return null;
  return severity === 'error' ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS;
}

/** The fields `update` may change. The id is the toast's identity and never moves. */
export type ToastPatch = Partial<Omit<ToastOptions, 'id'>> & { message?: string };

/** The queue. Newest last; the view decides how many to draw. */
export interface ToastStore {
  /** Raise a toast (or replace the one with the same id). Returns its id. */
  show: (message: string, options?: ToastOptions) => string;
  /** Change a toast on screen. A no-op for an id that already left. */
  update: (id: string, patch: ToastPatch) => void;
  /** Take one toast down — or, with no id, every toast. */
  dismiss: (id?: string, reason?: ToastDismissReason) => void;
  subscribe: (listener: () => void) => () => void;
  /** The current queue. A NEW array on every change, the same one otherwise. */
  getSnapshot: () => readonly ToastItem[];
}

function toItem(id: string, message: string, options: ToastOptions, revision: number): ToastItem {
  const severity = options.severity ?? 'neutral';
  return {
    id,
    message,
    severity,
    title: options.title,
    actions: options.actions ?? [],
    duration: options.duration === undefined ? defaultToastDuration(severity) : options.duration,
    dismissible: options.dismissible ?? true,
    assertive: options.assertive ?? false,
    testId: options.testId,
    onDismiss: options.onDismiss,
    revision,
  };
}

/** A fresh, empty queue. A host normally uses {@link defaultToastStore} instead. */
export function createToastStore(): ToastStore {
  let items: readonly ToastItem[] = [];
  let counter = 0;
  let revision = 0;
  const listeners = new Set<() => void>();

  const publish = (next: readonly ToastItem[]): void => {
    items = next;
    for (const listener of [...listeners]) listener();
  };

  const show = (message: string, options: ToastOptions = {}): string => {
    const id = options.id ?? `toast-${++counter}`;
    const previous = items.find((item) => item.id === id);
    const item = toItem(id, message, options, ++revision);
    // A replace keeps the toast's place in the queue, so the stack does not
    // reshuffle under the reader's eye when the same receipt is re-raised.
    publish(previous ? items.map((it) => (it.id === id ? item : it)) : [...items, item]);
    if (previous && previous.onDismiss !== options.onDismiss) previous.onDismiss?.('replaced');
    return id;
  };

  const update = (id: string, patch: ToastPatch): void => {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const { message, ...rest } = patch;
    const severity = rest.severity ?? current.severity;
    const next: ToastItem = {
      ...current,
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      message: message ?? current.message,
      severity,
      actions: rest.actions ?? current.actions,
      // A severity change without a stated duration takes the new severity's
      // default — a `loading` toast turned `success` must start to fade.
      duration:
        rest.duration !== undefined
          ? rest.duration
          : rest.severity !== undefined && rest.severity !== current.severity
            ? defaultToastDuration(severity)
            : current.duration,
      revision: ++revision,
    };
    publish(items.map((item) => (item.id === id ? next : item)));
  };

  const dismiss = (id?: string, reason: ToastDismissReason = 'api'): void => {
    const leaving = id === undefined ? items : items.filter((item) => item.id === id);
    if (leaving.length === 0) return;
    publish(id === undefined ? [] : items.filter((item) => item.id !== id));
    for (const item of leaving) item.onDismiss?.(reason);
  };

  return {
    show,
    update,
    dismiss,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => items,
  };
}

/** Raise a toast in one call, with a shortcut per severity. */
export interface Toaster {
  (message: string, options?: ToastOptions): string;
  success: (message: string, options?: Omit<ToastOptions, 'severity'>) => string;
  info: (message: string, options?: Omit<ToastOptions, 'severity'>) => string;
  warning: (message: string, options?: Omit<ToastOptions, 'severity'>) => string;
  error: (message: string, options?: Omit<ToastOptions, 'severity'>) => string;
  loading: (message: string, options?: Omit<ToastOptions, 'severity'>) => string;
  update: ToastStore['update'];
  dismiss: (id?: string) => void;
  /**
   * A `loading` toast for the life of a promise, turned into a success or an
   * error in place when it settles. Resolves (or rejects) with the promise.
   */
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((value: T) => string);
      error: string | ((error: unknown) => string);
    },
    options?: Omit<ToastOptions, 'severity'>,
  ) => Promise<T>;
  /** The queue this toaster raises into. */
  store: ToastStore;
}

/** Bind the one-call helpers to a queue. */
export function createToaster(store: ToastStore): Toaster {
  const raise = (message: string, options?: ToastOptions): string => store.show(message, options);
  const bySeverity =
    (severity: ToastSeverity) =>
    (message: string, options?: Omit<ToastOptions, 'severity'>): string =>
      store.show(message, { ...options, severity });

  const promise: Toaster['promise'] = async (pending, messages, options) => {
    const id = store.show(messages.loading, { dismissible: false, ...options, severity: 'loading' });
    try {
      const value = await pending;
      const message = typeof messages.success === 'function' ? messages.success(value) : messages.success;
      store.update(id, { message, severity: 'success', dismissible: options?.dismissible ?? true });
      return value;
    } catch (error) {
      const message = typeof messages.error === 'function' ? messages.error(error) : messages.error;
      store.update(id, { message, severity: 'error', dismissible: options?.dismissible ?? true });
      throw error;
    }
  };

  return Object.assign(raise, {
    success: bySeverity('success'),
    info: bySeverity('info'),
    warning: bySeverity('warning'),
    error: bySeverity('error'),
    loading: bySeverity('loading'),
    update: store.update,
    dismiss: (id?: string) => store.dismiss(id, 'api'),
    promise,
    store,
  });
}

/**
 * The process-wide queue. One per page is the point of the module: every
 * caller that raises into it lands in the same stack, drawn by the one
 * `ToastHost` the app mounts.
 */
export const defaultToastStore: ToastStore = createToastStore();

/** `toast('Saved')`, `toast.error('…')` — raised into {@link defaultToastStore}. */
export const toast: Toaster = createToaster(defaultToastStore);
