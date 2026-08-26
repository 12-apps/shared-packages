import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiLocale } from '../server/create-api-locale';

/**
 * The SERVER runtime manifest — the factory, which only a server holds.
 *
 * A constant rather than a function, unlike `@12-apps/auth`'s: that one is a
 * function because its `email` capability has to be handed a pack and a URL the
 * port cannot carry. There is no such choice here. The only thing this surface
 * needs is a store, and the store is what a host BINDS — so there is nothing
 * left for a factory argument to say.
 *
 * Behind its own subpath so a web bundle importing `.` or `./react` never
 * resolves the server half. Plain `satisfies`-checked value — see `./index` for
 * why the contract package stays a type-only devDependency; the inventory check
 * against the shared manifest runs in the test suite.
 */
export const i18nServerManifest = {
  name: '@12-apps/i18n',
  http: { create: createApiLocale },
} as const satisfies AnyServerManifest;
