/**
 * `@12-apps/shift/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiShift` (`../http`): the three shift routes as
 * descriptors, over the port the host implements with its policy layer. The
 * `jobs` half is the blueprints, unchanged from `../jobs`. A host adopting
 * this manifest binds both (`http` with its port, wire serializer and
 * resource vocabulary; `jobs` with `ShiftJobDeps`) or declines each in
 * writing; the consumer refuses a silent third state.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiShift } from '../http';
import { SHIFT_JOBS } from '../jobs';

export const shiftServerManifest = {
  name: '@12-apps/shift',
  http: { create: createApiShift },
  jobs: SHIFT_JOBS,
} as const satisfies AnyServerManifest;
