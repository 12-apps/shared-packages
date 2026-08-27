import type { JSX } from 'react';

import { EN_US_EMAIL_PREVIEW_COPY } from '@12-apps/notifications/email/previews/react';
import { notificationEmailPreviewsManifest } from '@12-apps/notifications/manifest';
import { notificationEmailPreviewsWebManifest } from '@12-apps/notifications/manifest/web';

import { webWiringHost } from '../wiring-web';

/**
 * The whole wiring a frontend host performs for the e-mail preview console —
 * the SECOND manifest `@12-apps/notifications` ships.
 *
 * Everything the screen IS — the owner grouping, the filter, the sandboxed
 * frame, the HTML/plain-text switch, the width toggle, the coverage strip and
 * the URL state — lives inside the package. This file names where the API is
 * mounted and which words the screen speaks; that is the only part genuinely
 * the host's.
 *
 * The catalogue itself is answered by `harness/backend`, over a real socket:
 * `vite.config.ts` proxies `/api`, and the backend's own adoption
 * (`src/email-host.ts`) declares the sources. So a click here crosses into the
 * package's Hono-bridged routes and back, which is the arrangement a real
 * consumer has — and it means the two halves of this package are proven
 * against each other rather than each against a stub.
 *
 * ## Why the copy is passed by name
 *
 * `EN_US_EMAIL_PREVIEW_COPY` is a shipped pack, chosen HERE. The package
 * exports two and defaults to neither, which is the copy-portability doctrine:
 * a package that defaulted a language would render another product's screen in
 * another product's words and nothing would say so. English, because every
 * package default this harness asserts is English.
 *
 * ## Adopted through the consumer, not by calling the factory
 *
 * `createEmailPreviewScreen` is right there and calling it would render the
 * same pixels. What that leaves on the floor is the DECLARATION: the surface
 * would be bound by nothing, `assemble()` would never hear about it, and the
 * completeness gate in `tests/manifest-web-adoption.spec.ts` would report a
 * package that ships a web surface no host adopted — which is precisely the
 * finding that brought this file into existence.
 */
const { surface } = webWiringHost.adoptWeb({
  manifest: notificationEmailPreviewsManifest,
  web: notificationEmailPreviewsWebManifest,
  bindings: {
    surface: {
      config: {
        apiBase: '/api/platform/email-previews',
        copy: EN_US_EMAIL_PREVIEW_COPY,
      },
    },
  },
});

const { page: EmailPreviewsSurface } = surface as { page: () => JSX.Element };

export function EmailPreviewsPage(): JSX.Element {
  return <EmailPreviewsSurface />;
}
