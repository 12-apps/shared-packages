/**
 * Bare bell trigger with the live unread badge — for hosts that do not already
 * have a styled icon-button slot.
 *
 * A host with its own trigger chrome uses `useBellBadge` + `Panel` directly,
 * and NOT `useUnreadCount`, which is what this sentence used to say. That
 * advice was taken, verbatim and by name, by a storefront whose header needed
 * its own trigger — and it gave that storefront a bell showing nothing at all
 * while a live pedido sat in the panel it opens, because `useUnreadCount`
 * counts inbox rows and knows nothing about what is happening right now.
 */
import type { JSX } from 'react';

import { Badge } from '@12-apps/ui/data-display/Badge';
import { Box } from '@12-apps/ui/mui/Box';

import type { NotificationMessages } from '../messages';

import { useInboxBellBadge, useLiveBellBadge } from './bell-badge';
import { BellIcon } from './bell-icon';
import type { NotificationsSignalHook, NotificationsSubscribe } from './hooks';
import type { LiveActivitiesConfig } from './live-config';
import type { LiveSeenStore } from './live-seen';
import type { InboxStore } from './inbox-state';

const triggerSx = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 0.5,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'text.primary',
  lineHeight: 0,
  '& *': { cursor: 'pointer' },
  '&:hover': { color: 'primary.main' },
  '&:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: '2px',
    borderRadius: '50%',
  },
} as const;

export interface BellButtonProps {
  onClick: () => void;
  /** Signed-out hosts still mount the bell; `false` silences it. */
  enabled?: boolean;
}

/**
 * The trigger itself, given a count and whether any of it is NEW.
 *
 * Presentational, and shared by both bells below, so the two can never drift on
 * what the badge looks like — only on where the number comes from.
 *
 * ## The two tones
 *
 * `primary` says *something happened*; `neutral` says *something is present*. A
 * live activity is the reason that distinction has to exist: it stays on the
 * panel for as long as the thing is happening, so a bell that painted every
 * live entry as new would be permanently red for a pedido the reader already
 * looked at, and a bell that ignored them would say nothing at all while one
 * was running. Grey keeps the count honest without spending attention twice.
 */
function BellTrigger({
  onClick,
  count,
  hasNew,
  messages,
}: {
  onClick: () => void;
  count: number;
  hasNew: boolean;
  messages: NotificationMessages;
}): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      // `openBellWithUnread` rather than a new message, and not for want of
      // precision: `NotificationMessages` is REQUIRED of every host, so adding
      // a field is a breaking change to a package several apps already mount.
      // The sentence a host wrote for "you have N" is the sentence this wants.
      aria-label={count > 0 ? messages.openBellWithUnread(count) : messages.openBell}
      data-testid="notifications-bell"
      sx={triggerSx}
    >
      <Badge
        content={count > 0 ? count : undefined}
        color={hasNew ? 'primary' : 'neutral'}
        variant="count"
        max={99}
        data-testid="notifications-badge"
        // The tone is carried by a colour, and a colour is not something a
        // test can read — nor, on its own, a signal every reader can. This is
        // what the tests assert on.
        data-tone={hasNew ? 'new' : 'seen'}
      >
        <BellIcon size={28} />
      </Badge>
    </Box>
  );
}

export function BellButton({
  onClick,
  enabled = true,
  store,
  messages,
  subscribe,
  useSignal,
}: BellButtonProps & {
  store: InboxStore;
  messages: NotificationMessages;
  subscribe?: NotificationsSubscribe;
  useSignal?: NotificationsSignalHook;
}): JSX.Element {
  const badge = useInboxBellBadge(store, {
    enabled,
    ...(subscribe ? { subscribe } : {}),
    ...(useSignal ? { useSignal } : {}),
  });
  return <BellTrigger onClick={onClick} {...badge} messages={messages} />;
}

/**
 * The bell for a host that configured live activities.
 *
 * A SECOND component rather than a flag on the one above, because the host's
 * `useActivities` is a hook: reading an optional config inside one component
 * would mean calling it conditionally, which React reports as a crash in some
 * unrelated component rather than here. The factory knows statically which host
 * it is building for and picks one.
 *
 * What the number MEANS, and what it costs the host, is `bell-badge.ts` — the
 * same hook a host with its own trigger chrome reaches through the factory's
 * `useBellBadge`, so the two bells can never disagree about the count.
 */
export function LiveBellButton({
  onClick,
  enabled = true,
  store,
  messages,
  subscribe,
  useSignal,
  live,
  seen,
}: BellButtonProps & {
  store: InboxStore;
  messages: NotificationMessages;
  subscribe?: NotificationsSubscribe;
  useSignal?: NotificationsSignalHook;
  live: LiveActivitiesConfig;
  seen: LiveSeenStore;
}): JSX.Element {
  const badge = useLiveBellBadge(store, live, seen, {
    enabled,
    ...(subscribe ? { subscribe } : {}),
    ...(useSignal ? { useSignal } : {}),
  });
  return <BellTrigger onClick={onClick} {...badge} messages={messages} />;
}
