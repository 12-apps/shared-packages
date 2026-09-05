/**
 * Bare bell trigger with the live unread badge — for hosts that do not already
 * have a styled icon-button slot. A host with its own trigger chrome uses
 * `useUnreadCount` + `Panel` directly.
 */
import { useSyncExternalStore, type JSX } from 'react';

import { Badge } from '@12-apps/ui/data-display/Badge';
import { Box } from '@12-apps/ui/mui/Box';

import type { NotificationMessages } from '../messages';

import { BellIcon } from './bell-icon';
import { useUnreadCount, type NotificationsSignalHook, type NotificationsSubscribe } from './hooks';
import type { LiveActivitiesConfig } from './live-config';
import { hasUnseenActivity, type LiveSeenStore } from './live-seen';
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
  const count = useUnreadCount(store, {
    enabled,
    ...(subscribe ? { subscribe } : {}),
    ...(useSignal ? { useSignal } : {}),
  });
  // No live config on this host: unread IS the whole count, and an unread row
  // is by definition something the reader has not seen.
  return <BellTrigger onClick={onClick} count={count} hasNew={count > 0} messages={messages} />;
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
 * ## What it costs the host, stated plainly
 *
 * The bell is mounted for as long as the app is, so unlike the panel's copy of
 * this hook there is no "nobody is looking" state to stand down in — `active`
 * is simply `enabled`. A host that answers by polling therefore polls for every
 * signed-in reader whether or not they ever open the centre. That is the price
 * of a badge that knows about live activities at all, and the reason to answer
 * this hook from a pushed cache rather than from an interval.
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
  const unread = useUnreadCount(store, {
    enabled,
    ...(subscribe ? { subscribe } : {}),
    ...(useSignal ? { useSignal } : {}),
  });
  const activities = live.useActivities({ active: enabled });
  const seenIso = useSyncExternalStore(seen.subscribe, seen.read, seen.read);
  const liveCount = enabled ? activities.length : 0;
  return (
    <BellTrigger
      onClick={onClick}
      // A live entry counts. It is a notification — it is the one the reader
      // most wants to know about — and the panel it opens lists it.
      count={unread + liveCount}
      hasNew={unread > 0 || (enabled && hasUnseenActivity(activities, seenIso))}
      messages={messages}
    />
  );
}
