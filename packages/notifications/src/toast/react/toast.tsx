/**
 * The declarative door into the toast column, for a toast whose state the
 * HOST owns: a receipt whose undo greys out while its write is in flight, a
 * notice that stays until a person closes it, a refusal keyed to one card.
 *
 * `<ToastPortal>` puts anything into the column's slot; `<Toast>` puts the
 * packaged card there. Both render where the host writes them, so their props
 * are live — no store round-trip per render.
 *
 * With no `ToastHost` above them they still stand in the same place, in a
 * column of their own: a screen mounted alone (a test, a storybook, an
 * embedded board) keeps its toasts where the app would draw them.
 */
import { useCallback, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Box } from '@12-apps/ui/mui/Box';

import type { ToastAction, ToastSeverity } from '../core';
import { defaultToastDuration } from '../core';

import { ToastCard } from './toast-card';
import { TOAST_VIEWPORT_SX, inBody, useToastViewport } from './toast-host';
import { useToastClock } from './use-toast-clock';

/** Render `children` in the toast column: the host's slot, or a column of their own. */
export function ToastPortal({ children }: { children: ReactNode }): JSX.Element | null {
  const viewport = useToastViewport();
  if (viewport !== null) {
    // The host's slot mounts in the host's own commit; until then, nothing.
    return viewport.slot === null ? null : createPortal(children, viewport.slot);
  }
  return (
    <>
      {inBody(
        <Box data-testid="toast-viewport-standalone" sx={TOAST_VIEWPORT_SX}>
          {children}
        </Box>,
      )}
    </>
  );
}

export interface ToastProps {
  /** Drawn while `true`. The host decides; the toast only asks to leave through `onClose`. */
  open: boolean;
  message: ReactNode;
  severity?: ToastSeverity;
  title?: string;
  actions?: readonly ToastAction[];
  /**
   * Ask to leave after this long (`onClose('timeout')`). `null` never asks.
   * Defaults to the severity's lifetime. The clock restarts when `restartKey`
   * changes.
   */
  duration?: number | null;
  restartKey?: unknown;
  dismissible?: boolean;
  /** The close button's name. Defaults to the host's `dismissLabel`. */
  dismissLabel?: string;
  onClose: (reason: 'timeout' | 'close' | 'action') => void;
  testId?: string;
}

function OpenToast({
  message,
  severity = 'neutral',
  title,
  actions = [],
  duration,
  restartKey,
  dismissible = true,
  dismissLabel,
  onClose,
  testId,
}: Omit<ToastProps, 'open'>): JSX.Element {
  const viewport = useToastViewport();
  const lifetime = duration === undefined ? defaultToastDuration(severity) : duration;
  const { pause, resume } = useToastClock(lifetime, restartKey, () => onClose('timeout'));
  const onAction = useCallback(
    (action: ToastAction) => {
      action.onClick();
      if (!action.keepOpen) onClose('action');
    },
    [onClose],
  );
  return (
    <ToastPortal>
      <Box
        role={severity === 'error' ? 'alert' : 'status'}
        aria-live={severity === 'error' ? 'assertive' : 'polite'}
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
        sx={{ flexShrink: 0 }}
      >
        <ToastCard
          message={message}
          severity={severity}
          title={title}
          actions={actions}
          dismissible={dismissible}
          dismissLabel={dismissLabel ?? viewport?.dismissLabel ?? ''}
          testId={testId}
          onAction={onAction}
          onClose={() => onClose('close')}
        />
      </Box>
    </ToastPortal>
  );
}

export function Toast({ open, ...props }: ToastProps): JSX.Element | null {
  return open ? <OpenToast {...props} /> : null;
}
