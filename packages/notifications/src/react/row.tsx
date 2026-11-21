/** One inbox row: unread accent, content (opens/marks read), timestamp, delete. */
import type { JSX, ReactNode } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import type { NotificationMessages } from '../messages';
import type { InboxNotification } from '../wire';

import { relativeTime } from './relative-time';
import type { NotificationActionsRenderer } from './row-actions';

const contentButtonSx = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
  textAlign: 'left',
  border: 'none',
  background: 'none',
  p: 0,
  cursor: 'pointer',
  color: 'text.primary',
  fontFamily: 'inherit',
} as const;

const unreadDotSx = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  bgcolor: 'primary.main',
  flex: '0 0 auto',
} as const;

/** The container width under which each action takes the whole row. */
const STACK_BELOW = '15rem';
/** The container width under which a control is held to the 40 px touch floor. */
const TOUCH_BELOW = '600px';

// The slot is its own CONTAINER, so every width decision below is about the room
// the row actually has (a 400 px drawer, a 320 px phone), never the viewport.
const actionsSlotSx = {
  flexBasis: '100%',
  minWidth: 0,
  containerType: 'inline-size',
} as const;

const actionsRowSx = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: 1,
  minWidth: 0,
  '& > *': { minWidth: 0, maxWidth: '100%' },
  [`@container (max-width: ${STACK_BELOW})`]: {
    '& > *': { flex: '1 1 100%' },
  },
  [`@container (max-width: ${TOUCH_BELOW})`]: {
    '& button, & a, & [role="button"]': { minHeight: 40, minWidth: 40 },
  },
} as const;

/** `null`, `undefined` and booleans draw nothing: the row stays as it was. */
function hasActions(actions: ReactNode): boolean {
  return actions !== null && actions !== undefined && typeof actions !== 'boolean';
}

/**
 * The host's controls, BESIDE the link, after it (and the delete control) in tab
 * order: a sibling of the stretched button, so a control here is never nested in
 * it and a click here never reaches it.
 */
function RowActions({
  notification,
  children,
}: {
  notification: InboxNotification;
  children: ReactNode;
}): JSX.Element {
  return (
    <Box sx={actionsSlotSx}>
      <Box
        role="group"
        aria-label={notification.title}
        data-testid={`notification-actions-${notification.id}`}
        sx={actionsRowSx}
      >
        {children}
      </Box>
    </Box>
  );
}

export function NotificationRow({
  notification,
  messages,
  onOpen,
  onDelete,
  renderActions,
}: {
  notification: InboxNotification;
  messages: NotificationMessages;
  onOpen: (notification: InboxNotification) => void;
  onDelete: (id: string) => void;
  renderActions?: NotificationActionsRenderer;
}): JSX.Element {
  const unread = notification.readAt === null;
  const actions = renderActions?.(notification);
  const withActions = hasActions(actions);
  return (
    <Box
      data-testid={`notification-${notification.id}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        ...(withActions ? { flexWrap: 'wrap' } : {}),
        py: 1.5,
        px: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: unread ? (t: Theme) => alpha(t.palette.primary.main, 0.06) : 'transparent',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onOpen(notification)}
        aria-label={
          unread ? `${notification.title} (${messages.unreadSuffix})` : notification.title
        }
        sx={contentButtonSx}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {unread ? <Box aria-hidden sx={unreadDotSx} /> : null}
          <Text variant="body" size="sm" weight={unread ? 'bold' : 'medium'} as="span">
            {notification.title}
          </Text>
        </Box>
        <Text variant="caption" size="xs" color="secondary" as="span">
          {notification.body}
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="span" italic>
          {relativeTime(notification.createdAt, messages)}
        </Text>
      </Box>

      <Button
        variant="ghost"
        color="neutral"
        size="xs"
        aria-label={messages.deleteOne(notification.title)}
        onClick={() => onDelete(notification.id)}
        dataTestId={`notification-delete-${notification.id}`}
      >
        ✕
      </Button>

      {withActions ? <RowActions notification={notification}>{actions}</RowActions> : null}
    </Box>
  );
}
