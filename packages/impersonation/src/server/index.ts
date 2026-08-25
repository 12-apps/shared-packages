/**
 * `@12-apps/impersonation/server` — the backend half, as framework-neutral route
 * descriptors plus the per-request gate.
 *
 * ```ts
 * const { routes, guard, readState } = createApiImpersonation({
 *   cookieName, secure, codec, timeBox,
 *   paths: { money, moneyReads, account, session },
 *   directory, audit, mintPolicy, previewPermission, messages,
 * });
 * ```
 *
 * `@12-apps/impersonation/hono` mounts `routes` in forty lines; a host on any
 * other framework writes the same adapter for itself.
 */
export { createApiImpersonation } from './create-api-impersonation';
export type { ApiImpersonation } from './create-api-impersonation';

export {
  ImpersonationApiError,
  fail,
  foldApiError,
  messagesOf,
  ok,
  resolveImpersonationCopy,
} from './context';
export type {
  ImpersonationActor,
  ImpersonationCopyResolver,
  ImpersonationCopySource,
  ImpersonationMessages,
  ImpersonationRequest,
  ImpersonationResponse,
  ImpersonationRoute,
  ImpersonationServerConfig,
  ImpersonationSurface,
} from './context';

export type {
  ImpersonationAuditBase,
  ImpersonationAuditPort,
  ImpersonationDirectory,
  ImpersonationEndEntry,
  ImpersonationMintContext,
  ImpersonationMintPolicy,
  ImpersonationRefusal,
  ImpersonationRefusedEntry,
  ImpersonationStartEntry,
  PreviewEntitlementPort,
} from './ports';

export { ImpersonationRefusedError } from './write-guard';
export type {
  GuardedRequest,
  ImpersonationGuard,
  ImpersonationWriteRefusal,
} from './write-guard';

export { NO_SESSION, bannerState } from './banner-state';
export type { LiveSession } from './live-session';
