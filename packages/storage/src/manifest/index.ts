/**
 * `@12-apps/storage/manifest` — the SHARED wiring manifest.
 *
 * Identity and the runtime inventory. Three absences are deliberate rather
 * than unfinished:
 *
 * - **No `db`.** This package owns no table. What an uploaded object leaves
 *   behind is a KEY, and the row that key hangs off is the host's own — a
 *   product image, a store logo — so there is nothing here to compose.
 * - **No `env`.** `./server`'s own header states the rule this manifest would
 *   otherwise have to restate: there are no `process.env` reads in shipped
 *   source, because every deployment-shaped decision (the driver, the byte
 *   ceiling, the key prefix, the bucket) is an ARGUMENT. A package that reads
 *   the environment decides for its host; this one asks.
 * - **No `web` inventory.** The React half is components a host renders, not
 *   a mountable surface with its own routes.
 *
 * `observability` is mandatory here because `http` is: a refused upload or a
 * driver that could not be reached files under `storage` rather than under
 * whichever host happened to mount it.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const storageManifest = {
  name: '@12-apps/storage',
  contract: 1,
  observability: { namespace: 'storage' },
  server: ['http'],
} as const satisfies PackageManifest;
