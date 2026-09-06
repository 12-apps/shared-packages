import { useState, type ComponentType, type JSX } from 'react';

import { messagesOf, type NotificationMessages } from '../messages';

import { createNotificationsApiClient, type NotificationsApiClient } from './api';
import { useInboxBellBadge, useLiveBellBadge, type BellBadge } from './bell-badge';
import { BellButton, LiveBellButton, type BellButtonProps } from './bell-button';
import {
  useUnreadCount,
  type NotificationsSignalHook,
  type NotificationsSubscribe,
} from './hooks';
import { createInboxStore, type InboxStore } from './inbox-state';
import type { LiveActivitiesConfig } from './live-config';
import { createLiveSeenStore, type LiveSeenStore } from './live-seen';
import { lazyNotificationsPanel } from './panel-lazy';
import type { NotificationsPanelProps } from './panel';
import { lazyPreferencesPage } from './page-lazy';
import type { PreferencesScreenProps } from './preferences-screen';
import { httpNotificationsTransport, type NotificationsTransport } from './transport';
import type { WebPushSetupConfig } from './web-push-setup';

/**
 * The one thing this package exposes to a FRONTEND host (12-15).
 *
 * Everything the notification centre IS — the bell with its live badge, the
 * slide-over inbox with its optimistic mark-read / delete / mark-all and its
 * cursor pager, the preferences matrix with its availability hints and the
 * per-browser push enable step, and every wire call between them — lives inside
 * this package. The host names where the API is mounted, and that is the whole
 * wiring.
 *
 * `page` is the standalone surface (the preferences screen), which is the one
 * thing a host routes to. The bell and the panel are a PAIR a host drops into
 * its own chrome, and they share one store, so a read in the panel moves the
 * badge in the same tick.
 */

export interface NotificationsWebConfig {
  /** The account mount the routes live under, e.g. `/api/account`. */
  apiBase: string;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: NotificationsTransport;
  /** User-facing copy overrides (pt-BR product copy by default). */
  messages: NotificationMessages;
  /**
   * How the surface learns an inbox changed without asking — the host's message
   * bus. Without it the badge keeps its 60 s poll, which is the standing
   * contract rather than a fallback: a dropped event must cost latency, never
   * correctness.
   */
  subscribe?: NotificationsSubscribe;
  /**
   * The same wiring as a HOOK, for a host whose realtime connection lives in
   * React context — see `NotificationsSignalHook`. `subscribe` is read at
   * factory time, which such a host cannot reach.
   */
  useSignal?: NotificationsSignalHook;
  /** The browser push enable step's host seams (SW path, platform hint). */
  webPush?: WebPushSetupConfig;
  /**
   * LIVE ACTIVITIES — the ongoing-state entries pinned above the inbox list.
   *
   * Opt-in, and absent means absent: a host that passes nothing gets the panel
   * it had, with no section, no heading and no reserved space. See
   * `./live-config` for the two things a host has to supply (where they come
   * from, and what the section says) and `../live` for what one IS.
   */
  liveActivities?: LiveActivitiesConfig;
}

export interface WebNotifications {
  /**
   * The routed surface: the preferences screen.
   *
   * Loaded on demand — see `page-lazy.tsx`. A host that mounts only the bell and
   * the panel never downloads it, and a host that routes to it fetches it while
   * entering that route.
   */
  page: ComponentType<PreferencesScreenProps>;
  /** The bell, already bound to the shared store. */
  BellButton: ComponentType<BellButtonProps>;
  /**
   * The inbox slide-over, sharing that store.
   *
   * Loaded the first time it is opened — see `panel-lazy.tsx`. Until then a
   * host's chrome carries the bell and nothing else.
   */
  Panel: ComponentType<NotificationsPanelProps>;
  /**
   * Bell + panel as ONE element, for a host that just wants the feature in its
   * header and does not want to own the open/closed state.
   */
  BellWithPanel: ComponentType<{
    enabled?: boolean;
    onNavigate?: (link: string) => void;
  }>;
  /** The badge number, for a host with its own trigger chrome. */
  useUnreadCount: (options?: { enabled?: boolean }) => number;
  /**
   * The badge's NUMBER AND TONE, for a host with its own trigger chrome.
   *
   * What `useUnreadCount` should have been for a host that also configured live
   * activities, and the reason it is a second door rather than a change to that
   * one: a count alone cannot express a bell, because a live entry is present
   * without being news (see `./bell-badge`). A host that renders
   * `useUnreadCount` in its own chrome gets a badge that ignores everything
   * happening right now — which is not a subtle wrongness, it is the pinned
   * pedido on screen going uncounted.
   *
   * Identical to what this package's own `BellButton` draws, because it is the
   * hook that bell uses. Without live activities configured it is
   * `useUnreadCount` plus `hasNew: count > 0`.
   */
  useBellBadge: (options?: { enabled?: boolean }) => BellBadge;
  /** The shared client state, for host glue. */
  store: InboxStore;
  /** The bound wire client. */
  api: NotificationsApiClient;
  /** The copy in force, so a host's own chrome can reuse a sentence. */
  messages: NotificationMessages;
}

/** What the factory passes both badge hooks: whatever realtime wiring it has. */
type SubscribeOption = {
  subscribe?: NotificationsSubscribe;
  useSignal?: NotificationsSignalHook;
};

/**
 * The two badge hooks, bound to this factory's store.
 *
 * `useBellBadge` is chosen ONCE here, the same way `Bell` is below and for the
 * same reason: `live.useActivities` is a hook, so which implementation runs
 * must not be a per-render decision.
 */
function bindBadgeHooks(
  store: InboxStore,
  subscribeOption: SubscribeOption,
  liveSeen: LiveSeenStore,
  live: LiveActivitiesConfig | undefined,
): Pick<WebNotifications, 'useUnreadCount' | 'useBellBadge'> {
  return {
    useUnreadCount: (options = {}) => useUnreadCount(store, { ...options, ...subscribeOption }),
    useBellBadge: live
      ? (options = {}) => useLiveBellBadge(store, live, liveSeen, { ...options, ...subscribeOption })
      : (options = {}) => useInboxBellBadge(store, { ...options, ...subscribeOption }),
  };
}

export function createWebNotifications(config: NotificationsWebConfig): WebNotifications {
  const messages = messagesOf(config);
  const api = createNotificationsApiClient(
    config.apiBase,
    config.transport ?? httpNotificationsTransport(messages.operationFailed),
  );
  const store = createInboxStore(api);
  const webPush = config.webPush ?? {};
  const subscribe = config.subscribe;
  const subscribeOption = {
    ...(subscribe ? { subscribe } : {}),
    ...(config.useSignal ? { useSignal: config.useSignal } : {}),
  };

  // One store per factory, shared by the bell that READS it and the panel that
  // WRITES it — the same arrangement as the inbox store above, and for the same
  // reason: two independent copies would disagree about what the reader saw.
  const liveSeen = createLiveSeenStore();

  // Chosen ONCE, here, because `useActivities` is a hook and the choice must
  // not be made per render: a bell that read an optional config inside itself
  // would be calling a hook conditionally.
  const live = config.liveActivities;
  const Bell: ComponentType<BellButtonProps> = live
    ? (props) => (
        <LiveBellButton
          {...props}
          store={store}
          messages={messages}
          live={live}
          seen={liveSeen}
          {...subscribeOption}
        />
      )
    : (props) => (
        <BellButton {...props} store={store} messages={messages} {...subscribeOption} />
      );
  const Panel = lazyNotificationsPanel({
    store,
    messages,
    ...(live ? { live, liveSeen } : {}),
  });

  const badgeHooks = bindBadgeHooks(store, subscribeOption, liveSeen, live);

  function BellWithPanel({
    enabled = true,
    onNavigate,
  }: {
    enabled?: boolean;
    onNavigate?: (link: string) => void;
  }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Bell enabled={enabled} onClick={() => setOpen(true)} />
        <Panel
          open={open}
          onClose={() => setOpen(false)}
          {...(onNavigate ? { onNavigate } : {})}
        />
      </>
    );
  }

  return {
    page: lazyPreferencesPage({ api, messages, webPush }),
    BellButton: Bell,
    Panel,
    BellWithPanel,
    ...badgeHooks,
    store,
    api,
    messages,
  };
}
