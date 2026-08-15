/**
 * Bare bell trigger with the live unread badge — for hosts that do not already
 * have a styled icon-button slot. A host with its own trigger chrome uses
 * `useUnreadCount` + `Panel` directly.
 */
import type { JSX } from 'react';

import { Badge } from '@12-apps/ui/data-display/Badge';
import { Box } from '@12-apps/ui/mui/Box';

import type { NotificationMessages } from '../messages';

import { BellIcon } from './bell-icon';
import { useUnreadCount, type NotificationsSignalHook, type NotificationsSubscribe } from './hooks';
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
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? messages.openBellWithUnread(count) : messages.openBell}
      data-testid="notifications-bell"
      sx={triggerSx}
    >
      <Badge
        content={count > 0 ? count : undefined}
        color="primary"
        variant="count"
        max={99}
        data-testid="notifications-badge"
      >
        <BellIcon size={28} />
      </Badge>
    </Box>
  );
}
