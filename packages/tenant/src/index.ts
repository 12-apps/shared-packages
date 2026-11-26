/**
 * `@12-apps/tenant` — the shared, runtime-free half: the config types every
 * factory takes, the tenant port's shape, and the startup validation.
 *
 * Backend: `@12-apps/tenant/server` (`createApiTenant`). Hono mount:
 * `@12-apps/tenant/hono`. Frontend: `@12-apps/tenant/react`
 * (`createWebTenant`). Adoption contract: ADOPTING.md.
 */
export {
  TENANT_COPY_KEYS,
  type TenantAuditActionIds,
  type TenantCopyConfig,
  type TenantCopyKey,
  type TenantCopyPack,
  type TenantCoreConfig,
  type TenantIds,
  type TenantNotificationTypeIds,
  type TenantPermissionIds,
  type TenantRefusalCodes,
  type TenantStatusSet,
} from './config';
export { TENANT_PORT_METHODS, type TenantPort, type TenantRecord } from './port';
export { TenantConfigError, validateCoreConfig, validatePort } from './validate';
export type { TenantReadings, TenantRefusalKind } from './core';
