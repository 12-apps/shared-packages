/**
 * `@12-apps/shift/manifest/server` — the server capability: the job
 * blueprints, unchanged from `./jobs`. A host adopting this manifest binds
 * `ShiftJobDeps` (its service and duration policy closed over into one
 * call) or declines the jobs capability in writing; the consumer refuses a
 * silent third state.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { SHIFT_JOBS } from '../jobs';

export const shiftServerManifest = {
  name: '@12-apps/shift',
  jobs: SHIFT_JOBS,
} as const satisfies AnyServerManifest;
