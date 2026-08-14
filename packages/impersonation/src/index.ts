/**
 * `@12-apps/impersonation` — an operator previews as a tenant user: reads are
 * scoped, writes are refused unless opted in, money paths are always refused,
 * and revoking the entitlement ends the session live.
 *
 * The ROOT entry is framework-free and runs in both halves: the cookie codec,
 * the path rules, the per-kind write rule, the permission vocabulary and the
 * shapes the wire agrees on. It imports no React, no Hono and no database.
 *
 * The two halves a host actually mounts live behind their own subpaths:
 *
 * ```ts
 * const { routes } = createApiImpersonation({ … });   // @12-apps/impersonation/server
 * const { banner, dialog } = createWebImpersonation({ … }); // …/react
 * ```
 */
export { createSessionCodec, toImpersonationState } from './core/session';
export type {
  ImpersonationCodec,
  ImpersonationSessionCodec,
  ImpersonationTimeBoxConfig,
  ReadImpersonationInput,
  SessionConfig,
  StartedImpersonation,
  StartImpersonationInput,
} from './core/session';

export { createPathRules, READ_METHODS } from './core/paths';
export type { ImpersonationPathRules, PathRules } from './core/paths';

export { impersonationPermitsWrites } from './core/write-rules';

export {
  IMPERSONATION_PERMISSION_IDS,
  IMPERSONATION_PERMISSIONS,
} from './core/permissions';

export type {
  ImpersonationBannerState,
  ImpersonationCookie,
  ImpersonationKind,
  ImpersonationSession,
  ImpersonationState,
  ImpersonationTarget,
  ImpersonationTenant,
  ImpersonationTimeBox,
  ImpersonationUser,
  OperatorSession,
  PreviewSession,
  PreviewSubject,
} from './core/types';
