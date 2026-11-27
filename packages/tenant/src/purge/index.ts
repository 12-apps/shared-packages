/**
 * The purge engine (opt-in, on top of the lifecycle): `createTenantPurge`,
 * the classification helper for the host's tests, and their types.
 */
export { createTenantPurge, type PurgeTenant } from './engine';
export {
  assertPurgeClassification,
  type TenantPurgeCatalog,
  type TenantPurgeClassificationOptions,
} from './classify';
export type {
  TenantPurge,
  TenantPurgeConfig,
  TenantPurgeEntry,
  TenantPurgeEraseEntry,
  TenantPurgeHeldChild,
  TenantPurgeHolder,
  TenantPurgeKeepAndStripEntry,
  TenantPurgeKeepEntry,
  TenantPurgeKeepRawEntry,
  TenantPurgeKey,
  TenantPurgeKeyThrough,
  TenantPurgeMirrorFields,
  TenantPurgeModel,
  TenantPurgeOutcome,
  TenantPurgeParsedKey,
  TenantPurgePlanStep,
  TenantPurgeStorage,
  TenantPurgeStrip,
} from './types';
