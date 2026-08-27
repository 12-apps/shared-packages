import type { AnyWebManifest } from '@12-apps/wiring';

import { createEmailPreviewScreen } from '../react/preview-screen';

/**
 * The WEB runtime manifest — the operator screen, which only a browser holds.
 *
 * One screen, named `page`, because a screen's NAME is what an area row
 * resolves against: a host reads `surface.page` by the name this manifest
 * carries, and a surface that was itself the component (rather than a record
 * of named screens) is the shape that made an area row resolve to `undefined`
 * in `@12-apps/auth` for a release.
 */
export const emailWebManifest = {
  name: '@12-apps/email',
  surface: { create: createEmailPreviewScreen },
} as const satisfies AnyWebManifest;
