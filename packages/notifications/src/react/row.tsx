/** One inbox row: unread accent, content (opens/marks read), timestamp, delete. */
import type { JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import type { NotificationMessages } from '../messages';
import type { InboxNotification } from '../wire';

import { relativeTime } from './relative-time';

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

export function NotificationRow({
  notification,
  messages,
  onOpen,
  onDelete,
}: {
  notification: InboxNotification;
  messages: NotificationMessages;
  onOpen: (notification: InboxNotification) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const unread = notification.readAt === null;
  return (
    <Box
      data-testid={`notification-${notification.id}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
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
    </Box>
  );
}
