import type { Rbac } from '../core/engine';
import type { Scope } from '../core/types';
import { PermissionDeniedError } from '../core/errors';

/** Server guards bound to an engine and a host-supplied actor resolver. */
export interface RbacGuards<P extends string> {
  /**
   * Resolve the actor via `getActorId`, then require `permission` in `scope`.
   * Throws {@link PermissionDeniedError} when there is no actor or when denied.
   */
  requirePermission(permission: P, scope: Scope): Promise<void>;
  /** Non-throwing check; a null actor is treated as denied (`false`). */
  can(permission: P, scope: Scope): Promise<boolean>;
}

/**
 * Framework-neutral server adapter. The host supplies `getActorId` (e.g. from
 * its session) so this module imports nothing framework-specific — no
 * `next/server`. The host maps {@link PermissionDeniedError} to a 403 in its
 * own route handler / server action.
 */
export function createRbacGuards<P extends string>(
  rbac: Rbac<P>,
  getActorId: () => Promise<string | null>,
): RbacGuards<P> {
  return {
    async requirePermission(permission, scope) {
      const actorId = await getActorId();
      if (actorId === null) {
        throw new PermissionDeniedError('anonymous', permission, scope);
      }
      await rbac.requirePermission(actorId, permission, null, { scope });
    },

    async can(permission, scope) {
      const actorId = await getActorId();
      if (actorId === null) return false;
      return rbac.can(actorId, permission, null, { scope });
    },
  };
}
