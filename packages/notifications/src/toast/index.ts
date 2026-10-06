/**
 * `@12-apps/notifications/toast` — the framework-free toast queue.
 *
 * `toast('Saved')` from anywhere; the React half
 * (`@12-apps/notifications/toast/react`) draws it. See `./core.ts`.
 */
export {
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
  TOAST_SEVERITIES,
  createToastStore,
  createToaster,
  defaultToastDuration,
  defaultToastStore,
  toast,
  type ToastAction,
  type ToastDismissReason,
  type ToastItem,
  type ToastOptions,
  type ToastPatch,
  type ToastSeverity,
  type ToastStore,
  type Toaster,
} from './core';
