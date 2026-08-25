import { useState, type ComponentType, type JSX } from 'react';

import { messagesOf, type NotificationMessages } from '../messages';

import { createNotificationsApiClient, type NotificationsApiClient } from './api';
import { BellButton, type BellButtonProps } from './bell-button';
import {
  useUnreadCount,
  type NotificationsSignalHook,
  type NotificationsSubscribe,
} from './hooks';
import { createInboxStore, type InboxStore } from './inbox-state';
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
  /** The shared client state, for host glue. */
  store: InboxStore;
  /** The bound wire client. */
  api: NotificationsApiClient;
  /** The copy in force, so a host's own chrome can reuse a sentence. */
  messages: NotificationMessages;
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

  const Bell: ComponentType<BellButtonProps> = (props) => (
    <BellButton {...props} store={store} messages={messages} {...subscribeOption} />
  );
  const Panel = lazyNotificationsPanel({ store, messages });

  function useBoundUnreadCount(options: { enabled?: boolean } = {}): number {
    return useUnreadCount(store, { ...options, ...subscribeOption });
  }

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
    useUnreadCount: useBoundUnreadCount,
    store,
    api,
    messages,
  };
}
