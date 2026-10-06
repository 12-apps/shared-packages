/**
 * Where every toast is drawn: ONE fixed column at the top of the screen,
 * centred, as wide as a phone and no wider (`sm`), 12px off the top edge and
 * the safe area. A host mounts `ToastHost` once at its root; everything raised
 * with `toast(…)` and every `<Toast>` / `<ToastPortal>` anywhere below lands in
 * it, in the same place and the same look.
 *
 * The column takes no room in the page (it is an overlay) and no taps (only the
 * cards do), so the page under its gaps stays usable.
 *
 * It carries `data-ui-toast-column`: everything in it either leaves on its own
 * or has a close button, which is what lets a screen-review probe treat a
 * control it briefly covers differently from one a fixed bar covers for good.
 *
 * Two lanes inside it, in this order:
 *  1. the queue (`toast(…)`): newest first, at most `max` drawn; the rest wait
 *     their turn with their clocks stopped, and a quiet line says how many;
 *  2. the SLOT: what hosts render declaratively — a receipt whose button greys
 *     out while its write is in flight is state the host owns, so it is drawn
 *     where the host renders it and portalled here. The slot fills what the
 *     queue leaves of the column, so a host body with its own scroller gets a
 *     definite height to scroll in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Box } from '@12-apps/ui/mui/Box';
import { type Theme } from '@12-apps/ui/mui/styles';
import { stackedOverlayZIndex } from '@12-apps/ui/tokens/layers';
import { Text } from '@12-apps/ui/typography/Text';

import { defaultToastStore, type ToastAction, type ToastItem, type ToastStore } from '../core';

import { useStaysAnnounced } from './stays-announced';
import { ToastCard, ToastSurface } from './toast-card';
import { useToastClock } from './use-toast-clock';

/** The gap between the column and the screen's edges. */
const EDGE_GAP_PX = 12;

/** How many queued toasts are drawn at once. */
export const TOAST_MAX_VISIBLE = 3;

/**
 * The column. Exported so a fallback (a `ToastPortal` with no host above it)
 * stands exactly where the host would. Its height is DEFINITE (top and bottom
 * are both set) so the slot can hand its children a percentage to resolve.
 */
export const TOAST_VIEWPORT_SX = {
  position: 'fixed',
  top: `calc(env(safe-area-inset-top, 0px) + ${EDGE_GAP_PX}px)`,
  bottom: `calc(env(safe-area-inset-bottom, 0px) + ${EDGE_GAP_PX}px)`,
  left: EDGE_GAP_PX,
  right: EDGE_GAP_PX,
  mx: 'auto',
  maxWidth: (theme: Theme) => theme.breakpoints.values.sm,
  // Over every sheet: a toast raised from inside a stacked modal must not
  // land under it. The same height a menu portalled out of a sheet takes.
  zIndex: (theme: Theme) => stackedOverlayZIndex(theme) + 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  pointerEvents: 'none',
} as const;

/**
 * Rendered under `<body>`, not where the host mounted it: a `fixed` column
 * inside a transformed or `contain`ed ancestor is positioned against THAT box,
 * and lands wherever the app's shell happens to be. Under `<body>` it is the
 * screen's, every time.
 */
export function inBody(node: ReactNode): ReactNode {
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
}

interface ToastViewportValue {
  /** The element `ToastPortal` renders into — `null` until the host has mounted it. */
  slot: HTMLElement | null;
  dismissLabel: string;
}

const ToastViewportContext = createContext<ToastViewportValue | null>(null);

/**
 * The mounted host, for a portal that is NOT inside it.
 *
 * The context answers for what the host wraps. A host may also be mounted as
 * a SIBLING — the storefront loads it lazily, off its critical path, after the
 * first render — so the host also registers here, and a portal outside it
 * finds it all the same. One host per page is the contract; the last one
 * mounted answers.
 */
let registered: ToastViewportValue | null = null;
const registryListeners = new Set<() => void>();

function register(value: ToastViewportValue | null): void {
  registered = value;
  for (const listener of [...registryListeners]) listener();
}

function subscribeRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

const readRegistry = (): ToastViewportValue | null => registered;

/** The host's slot and words — the enclosing host's, else the mounted one's, else `null`. */
export function useToastViewport(): ToastViewportValue | null {
  const enclosing = useContext(ToastViewportContext);
  const mounted = useSyncExternalStore(subscribeRegistry, readRegistry, () => null);
  return enclosing ?? mounted;
}

export interface ToastHostProps {
  /** The close button's accessible name, for every toast. REQUIRED — the package ships no copy. */
  dismissLabel: string;
  /** The quiet line under the stack naming how many wait their turn ("+2 more"). REQUIRED. */
  moreLabel: (count: number) => string;
  /** The queue to draw. Defaults to the process-wide one `toast(…)` raises into. */
  store?: ToastStore;
  /** How many queued toasts are drawn at once. */
  max?: number;
  children?: ReactNode;
}

function QueuedToast({
  item,
  store,
  dismissLabel,
}: {
  item: ToastItem;
  store: ToastStore;
  dismissLabel: string;
}): JSX.Element {
  const { pause, resume } = useToastClock(item.duration, item.revision, () => store.dismiss(item.id, 'timeout'));
  const onAction = useCallback(
    (action: ToastAction) => {
      action.onClick();
      if (!action.keepOpen) store.dismiss(item.id, 'action');
    },
    [store, item.id],
  );
  return (
    <Box
      // An error is news that must interrupt; everything else waits its turn
      // in the column's polite region.
      role={item.severity === 'error' || item.assertive ? 'alert' : undefined}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      sx={{ flexShrink: 0 }}
    >
      <ToastCard
        message={item.message}
        severity={item.severity}
        title={item.title}
        actions={item.actions}
        dismissible={item.dismissible}
        dismissLabel={dismissLabel}
        testId={item.testId}
        onAction={onAction}
        onClose={() => store.dismiss(item.id, 'close')}
      />
    </Box>
  );
}

export function ToastHost({
  dismissLabel,
  moreLabel,
  store = defaultToastStore,
  max = TOAST_MAX_VISIBLE,
  children,
}: ToastHostProps): JSX.Element {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, dismissLabel }), [slot, dismissLabel]);
  useEffect(() => {
    register(value);
    return () => {
      if (registered === value) register(null);
    };
  }, [value]);
  const announced = useStaysAnnounced();
  // Newest first: the toast nearest the top edge is the answer to the last tap.
  const visible = items.slice(-max).reverse();
  const waiting = items.length - visible.length;

  return (
    <ToastViewportContext.Provider value={value}>
      {children}
      {inBody(
      <Box ref={announced} data-testid="toast-viewport" data-ui-toast-column="" sx={TOAST_VIEWPORT_SX}>
        {/* Always mounted, so a toast added to it is announced: a live region
            has to be in the tree before its content changes. */}
        <Box
          aria-live="polite"
          aria-atomic="false"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}
        >
          {visible.map((item) => (
            <QueuedToast key={item.id} item={item} store={store} dismissLabel={dismissLabel} />
          ))}
          {waiting > 0 && (
            <ToastSurface testId="toast-more" sx={{ alignSelf: 'center', px: 1.5, py: 0.25 }}>
              <Text variant="caption" as="p">
                {moreLabel(waiting)}
              </Text>
            </ToastSurface>
          )}
        </Box>
        <Box
          ref={setSlot}
          data-testid="toast-slot"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 auto', minHeight: 0 }}
        />
      </Box>,
      )}
    </ToastViewportContext.Provider>
  );
}
