/**
 * The routed preferences screen, fetched when a host actually routes to it.
 *
 * `createWebNotifications` returns two different KINDS of thing, and its own
 * docstring says so: `page` is "the standalone surface … the one thing a host
 * routes to", while the bell and the panel "are a PAIR a host drops into its own
 * chrome". Chrome is on screen from the first paint; a routed surface is not.
 *
 * A static import made that distinction invisible to a bundler. Every host that
 * put the bell in its header also shipped the preferences matrix — its channel
 * toggles, the per-browser push enable step, and the design-system `Switch`
 * behind them — in the same chunk as the header. A storefront paid for a
 * settings screen a shopper never opens, before its first screen could render;
 * a host that renders its OWN preferences page paid for this one twice.
 *
 * So `page` now loads on demand. Nothing else moves: the bell, the panel and
 * `BellWithPanel` stay exactly as eager as the chrome they belong to, because
 * that is what they are.
 *
 * NO PREFETCH, deliberately, and this is the opposite call from a surface a
 * host opens from chrome it already has. A routed surface is reached by
 * NAVIGATION, and every host here already code-splits its routes — so the
 * fetch happens while the route is being entered, which is the moment a
 * prefetch would have been trying to anticipate. Warming it at factory time
 * would put the screen back on the boot path of every app, which is the whole
 * cost this removes.
 */
import { Suspense, lazy, type ComponentType, type JSX } from 'react';

import type { NotificationMessages } from '../messages';

import type { NotificationsApiClient } from './api';
import type { PreferencesScreenProps } from './preferences-screen';
import type { WebPushSetupConfig } from './web-push-setup';

/** What the factory binds into the screen, and the host never passes. */
export interface PreferencesPageParts {
  api: NotificationsApiClient;
  messages: NotificationMessages;
  webPush: WebPushSetupConfig;
}

/**
 * The routed screen, bound and loaded on first render.
 *
 * `lazy` memoises its factory, so the binding below happens once however many
 * times a host mounts the page — the same guarantee the direct call gave.
 *
 * The fallback is `null` because a host routes to this: whatever it renders
 * around the route is already on screen, and a second spinner inside it would
 * be one more thing appearing and disappearing during a navigation the host is
 * already indicating.
 */
export function lazyPreferencesPage(
  parts: PreferencesPageParts,
): ComponentType<PreferencesScreenProps> {
  const Bound = lazy(async () => {
    const { PreferencesScreen } = await import('./preferences-screen');
    return {
      default: (props: PreferencesScreenProps): JSX.Element => (
        <PreferencesScreen {...props} {...parts} />
      ),
    };
  });

  return function NotificationsPreferencesPage(props: PreferencesScreenProps): JSX.Element {
    return (
      <Suspense fallback={null}>
        <Bound {...props} />
      </Suspense>
    );
  };
}
