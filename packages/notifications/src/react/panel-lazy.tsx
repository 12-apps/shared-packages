/**
 * The inbox slide-over, fetched the first time somebody opens it.
 *
 * The bell and the panel are a PAIR a host drops into its chrome, and that is
 * still true — but only the BELL is on screen when a page paints. The panel is
 * behind a tap, and a static import made every host pay for it up front: the
 * design-system `Drawer` and, through it, MUI's `SwipeableDrawer`, `Modal`,
 * `Slide` and the focus trap, plus the row, the empty state and the pager. On a
 * storefront that is a slide-over most visits never open, parsed before the
 * first screen can render.
 *
 * ## Why the gate is "ever opened" rather than `open`
 *
 * `lazy` fetches when a component first RENDERS, so a boundary that still
 * rendered the panel while closed would fetch immediately and buy nothing. This
 * renders `null` until the panel has been open once, which is what actually
 * defers the download to the tap.
 *
 * And once opened it STAYS mounted. Unmounting on close would throw away the
 * drawer's transition state, so the panel would vanish instead of sliding out,
 * and the entrance animation would re-run on every reopen — which someone
 * working through an inbox does repeatedly. The fetch happens once.
 *
 * The initial state reads `open` rather than starting at `false`, so a host that
 * mounts the panel already open renders it in the same commit instead of a frame
 * later.
 *
 * ## Why `null` for the fallback
 *
 * The only frame this can show anything is the one right after the tap, where a
 * spinner reads as a stall rather than as progress. The chunk is small and
 * same-origin.
 */
import { Suspense, lazy, useEffect, useState, type ComponentType, type JSX } from 'react';

import type { NotificationMessages } from '../messages';

import type { InboxStore } from './inbox-state';
import type { NotificationsPanelProps } from './panel';

/** What the factory binds into the panel, and the host never passes. */
export interface PanelParts {
  store: InboxStore;
  messages: NotificationMessages;
}

export function lazyNotificationsPanel(
  parts: PanelParts,
): ComponentType<NotificationsPanelProps> {
  const Bound = lazy(async () => {
    const { NotificationsPanel } = await import('./panel');
    return {
      default: (props: NotificationsPanelProps): JSX.Element => (
        <NotificationsPanel {...props} {...parts} />
      ),
    };
  });

  return function NotificationsPanelSlot(props: NotificationsPanelProps): JSX.Element | null {
    const [everOpened, setEverOpened] = useState(props.open);

    useEffect(() => {
      if (props.open) setEverOpened(true);
    }, [props.open]);

    if (!everOpened) return null;

    return (
      <Suspense fallback={null}>
        <Bound {...props} />
      </Suspense>
    );
  };
}
