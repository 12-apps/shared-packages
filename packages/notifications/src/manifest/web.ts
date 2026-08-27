/**
 * `@12-apps/notifications/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebNotifications`, unchanged: the bell, the inbox
 * slide-over, the preferences screen and the bound store, built once per
 * adoption by the consumer's binder (the members are component TYPES, so
 * rebuilding per render unmounts the panel mid-interaction — the memoisation
 * rule every hand wiring carries as a comment today).
 *
 * ## Why this manifest exists now
 *
 * It was narrowed away with a reason that reads plausibly and is FALSE:
 * "listing `web` would oblige every server host adopting this manifest to
 * answer for a React surface it never mounts." The consumer does not work
 * that way. A capability declared for the other runtime is reported
 * `out-of-scope` — "a web host answers for this" — and `assemble()` returns
 * fine; only a capability applicable to THIS runtime and unanswered is
 * `unbound`. `wiring`'s own fixture package declares both halves and its
 * server-host suite asserts exactly that.
 *
 * The narrowing therefore bought nothing and cost the thing the capability is
 * for. `./react` and `./web-push` ship Bell, Panel and Preferences — the exact
 * screens the adaptation report wanted to stop being hand-duplicated in hosts,
 * and the origin host duplicated the preferences screen and the push setup
 * anyway, because a manifest that never mentions them is a manifest nobody
 * discovers them from.
 *
 * ## Why there are no `areas`
 *
 * The bell is not a routed screen: it lives in a host's header chrome, beside
 * whatever else that host puts there, and no package can suggest a route for
 * it. Preferences IS routed, but where it belongs differs per host — under
 * account settings in one app, under a tenant's configuration in another — and
 * it is offered as `page` on the surface for the host to route at its own
 * call site. A suggested nav row would be wrong for every host but the first,
 * which is the `AreaContribution` doctrine's own test.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createEmailPreviewScreen } from '../email/previews/react/preview-screen';
import { createWebNotifications } from '../react/create-web-notifications';

export const notificationsWebManifest = {
  name: '@12-apps/notifications',
  surface: { create: createWebNotifications },
} as const satisfies AnyWebManifest;

/**
 * The preview console's web half.
 *
 * One screen, named `page`, because a screen's NAME is what an area row
 * resolves against — a surface that was itself the component is the shape that
 * made an area row resolve to `undefined` in `@12-apps/auth` for a release.
 */
export const notificationEmailPreviewsWebManifest = {
  name: '@12-apps/notifications-email-previews',
  surface: { create: createEmailPreviewScreen },
} as const satisfies AnyWebManifest;
