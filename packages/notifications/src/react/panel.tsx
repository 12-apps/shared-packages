/**
 * The notification-centre slide-over: newest-first list with unread styling,
 * per-item open (marks read + deep-links), soft delete, mark-all, empty /
 * loading / error states and a "load more" cursor pager.
 *
 * Rendering is app-agnostic — the host passes `onNavigate` (its router's
 * navigate) for deep links. Without one a link is simply not followed, which is
 * what lets the panel mount in a host that has no router at all.
 */
import { useCallback, type JSX } from 'react';

import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Button } from '@12-apps/ui/form/Button';
import { Drawer, DrawerContent, DrawerHeader } from '@12-apps/ui/layout/Drawer';
import { Box } from '@12-apps/ui/mui/Box';
import { useMediaQuery } from '@12-apps/ui/mui/useMediaQuery';
import { useTheme } from '@12-apps/ui/mui/styles';

import type { LiveActivity } from '../live';
import type { NotificationMessages } from '../messages';
import type { InboxNotification } from '../wire';

import { BellIcon } from './bell-icon';
import { useInboxList } from './hooks';
import type { InboxState, InboxStore } from './inbox-state';
import type { LiveActivitiesConfig } from './live-config';
import { LiveSection } from './live-section';
import { NotificationRow } from './row';

interface PanelBodyProps {
  state: InboxState;
  messages: NotificationMessages;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (notification: InboxNotification) => void;
  onDelete: (id: string) => void;
}

/** The scrollable panel body: loading / error / empty / the list + pager. */
function PanelBody({
  state,
  messages,
  onRetry,
  onLoadMore,
  onOpen,
  onDelete,
}: PanelBodyProps): JSX.Element {
  if (state.status === 'pending' || state.status === 'idle') {
    return (
      <LoadingState
        variant="spinner"
        message={messages.loading}
        size="md"
        dataTestId="notifications-loading"
      />
    );
  }
  if (state.status === 'error') {
    return (
      <EmptyState
        variant="minimal"
        title={messages.loadFailedTitle}
        description={messages.loadFailedBody}
        onRefresh={onRetry}
        refreshLabel={messages.retry}
        dataTestId="notifications-error"
      />
    );
  }
  if (state.items.length === 0) {
    return (
      <EmptyState
        variant="illustrated"
        illustration={<BellIcon size={44} dim />}
        title={messages.emptyTitle}
        description={messages.emptyBody}
        dataTestId="notifications-empty"
      />
    );
  }
  return (
    <Box>
      {state.items.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          messages={messages}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
      {state.nextCursor ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
          <Button
            variant="outline"
            color="neutral"
            size="sm"
            disabled={state.loadingMore}
            onClick={onLoadMore}
            dataTestId="notifications-load-more"
          >
            {state.loadingMore ? messages.loadingMore : messages.loadMore}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * The two open gestures, which are ONE deep-link path with a mark-read in front
 * of half of it.
 *
 * Lifted out of the component because both kinds of entry follow a link the
 * same way and a host with no router follows neither — one rule, stated once,
 * rather than the same three lines written twice.
 */
function usePanelOpeners(
  store: InboxStore,
  onClose: () => void,
  onNavigate?: (link: string) => void,
): {
  openNotification: (notification: InboxNotification) => void;
  openLive: (activity: LiveActivity) => void;
} {
  const follow = useCallback(
    (link: string | null) => {
      if (!link || !onNavigate) return;
      onClose();
      onNavigate(link);
    },
    [onClose, onNavigate],
  );

  return {
    openNotification: useCallback(
      (notification: InboxNotification) => {
        if (notification.readAt === null) store.markRead([notification.id]);
        follow(notification.link);
      },
      [store, follow],
    ),
    openLive: useCallback((activity: LiveActivity) => follow(activity.link), [follow]),
  };
}

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Navigate to a notification's in-app link (the host's router). */
  onNavigate?: (link: string) => void;
}

export function NotificationsPanel({
  open,
  onClose,
  onNavigate,
  store,
  messages,
  live,
}: NotificationsPanelProps & {
  store: InboxStore;
  messages: NotificationMessages;
  live?: LiveActivitiesConfig;
}): JSX.Element {
  // `useTheme` from @mui/material/styles falls back to the DEFAULT theme when
  // no provider is mounted, where the callback form of `useMediaQuery` would
  // hand the callback a null theme and throw. A published component must render
  // in a host that has not wrapped it yet.
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const state = useInboxList(store, open);

  const { openNotification, openLive } = usePanelOpeners(store, onClose, onNavigate);

  const hasUnread = state.items.some((item) => item.readAt === null);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      anchor="right"
      variant="right"
      width={isMobile ? '100vw' : 400}
      dataTestId="notifications-panel"
    >
      <DrawerHeader onClose={onClose}>{messages.panelTitle}</DrawerHeader>
      <DrawerContent>
        {/*
          Above the mark-all control as well as above the list, deliberately:
          "marcar todas como lidas" belongs to the INBOX, and a live entry has
          nothing to mark. A control between the two blocks would read as
          applying to both.
        */}
        {live ? (
          <LiveSection
            config={live}
            messages={messages}
            active={open}
            {...(onNavigate ? { onOpen: openLive } : {})}
          />
        ) : null}
        {hasUnread ? (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pb: 1 }}>
            <Button
              variant="ghost"
              color="primary"
              size="xs"
              onClick={() => store.markAllRead()}
              dataTestId="notifications-mark-all-read"
            >
              {messages.markAllRead}
            </Button>
          </Box>
        ) : null}
        <PanelBody
          state={state}
          messages={messages}
          onRetry={() => store.invalidate()}
          onLoadMore={() => store.loadMore()}
          onOpen={openNotification}
          onDelete={(id) => store.remove(id)}
        />
      </DrawerContent>
    </Drawer>
  );
}
