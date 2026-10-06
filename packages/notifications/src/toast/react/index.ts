/**
 * `@12-apps/notifications/toast/react` — where toasts are drawn.
 *
 * Mount `ToastHost` once at the app's root (it takes the close button's name
 * and the "+N" line, the only words it says). Then raise from anywhere:
 *
 * ```tsx
 * import { toast } from '@12-apps/notifications/toast';
 * toast.success('Saved');
 * toast('Item moved', { actions: [{ label: 'Undo', onClick: undo }] });
 * ```
 *
 * A toast whose state the host owns (live props, its own buttons or scroller)
 * is rendered declaratively — `<Toast open …>` for the packaged card,
 * `<ToastPortal>` + `<ToastSurface>` for a body of the host's own — and lands in
 * the same column, in the same look.
 */
export {
  TOAST_MAX_VISIBLE,
  TOAST_VIEWPORT_SX,
  ToastHost,
  useToastViewport,
  type ToastHostProps,
} from './toast-host';
export { Toast, ToastPortal, type ToastProps } from './toast';
export { ToastCard, ToastSurface, type ToastCardProps } from './toast-card';
export { InverseTheme, inverseColors, inverseTheme, toastSurfaceSx } from './inverse';
export { useToastStore } from './use-toast-store';
