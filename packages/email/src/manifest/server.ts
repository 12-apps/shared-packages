import type { AnyServerManifest } from '@12-apps/wiring';

import { emailPreviewRoutes } from '../server/preview-routes';
import type { EmailPreviewsConfig } from '../server/catalog';

/**
 * The SERVER runtime manifest — the factory, which only a server holds.
 *
 * A FUNCTION rather than a constant, unlike `@12-apps/i18n`'s: that surface
 * needs only a store, which a host binds, so there is nothing left for a
 * factory argument to say. This one cannot be built without knowing WHICH
 * messages exist, and that is not a port a host can bind after the fact — it is
 * the whole input. So the factory takes the config and hands back the routes.
 *
 * Behind its own subpath so a web bundle importing `.` or `./react` never
 * resolves the server half.
 */
export function emailServerManifest(config: EmailPreviewsConfig) {
  return {
    name: '@12-apps/email',
    http: { create: () => ({ routes: emailPreviewRoutes(config) }) },
  } as const satisfies AnyServerManifest;
}
