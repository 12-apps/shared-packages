import type { Rbac } from '../core/engine';

import {
  RbacApiError,
  messagesOf,
  type RbacActor,
  type RbacRoute,
  type RbacServerConfig,
} from './context';
import { createDbEngine } from './engine';
import { createGrantGovernance, type GrantGovernance } from './grant-governance';
import { createRbacGuards, type RbacGuards } from './guards';
import { roleRoutes } from './routes-roles';
import { teamRoutes } from './routes-team';
import { createRolesStore, type RolesStore } from './roles-store';
import { tenantRoleSeedRows } from './template-store';
import { createTeamStore, type TeamStore } from './team-store';
import { buildWireSchemas } from './wire';

/**
 * The one thing this package exposes to a BACKEND host (12-13).
 *
 * The endpoints used to live in the host: fourteen route files that parsed a
 * request, guarded it, called a repository and shaped a response — plus the
 * repositories, the governance and the engine wiring behind them, ~1.6k LOC.
 * Only "who is calling, on which tenant" was ever the host's business; the
 * rest is this surface's contract, and the frontend half of that contract
 * (`createWebRbac`) lives here too, so the two can never drift.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router — the
 * report-builder doctrine. `@12-apps/rbac/hono` adapts them in forty lines.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — the host hands over a
 *    {@link RbacActor} (user id, tenant id, platform-admin flag).
 *  - **Identity** — email/name for a user id, through the directory port.
 *  - **Entitlements and quota** — billing questions, answered before the
 *    request reaches a descriptor (e.g. in the host's `resolveActor`).
 *  - **Where the data lives** — the five owned models through the db seam.
 */
export interface ApiRbac<P extends string> {
  /** The whole admin surface, in mount order. */
  routes: RbacRoute[];
  /** The guard helpers every OTHER host surface calls (requirePermission…). */
  guards: RbacGuards<P>;
  /** The wired engine, for hosts composing their own decisions. */
  engine: Rbac<P>;
  /** The grant governance, shared with any host-side write path. */
  governance: GrantGovernance;
  /** The stores, for host surfaces that read the same tables (nav, MCP…). */
  roles: RolesStore;
  team: TeamStore;
  /**
   * Materialize the per-tenant SYSTEM role catalog for a new tenant —
   * idempotent (deterministic ids + skipDuplicates), called in the host's
   * tenant-creation transaction.
   */
  seedTenantRoles(tenantId: string): Promise<void>;
}

export function createApiRbac<P extends string>(config: RbacServerConfig<P>): ApiRbac<P> {
  const engine = createDbEngine(config);
  const guards = createRbacGuards(engine, config);
  const governance = createGrantGovernance(config, guards);
  const roles = createRolesStore(config);
  const team = createTeamStore(config);
  const wire = buildWireSchemas(config.permissions);
  const messages = messagesOf(config);
  const customerRole = config.customerRole ?? 'CUSTOMER';

  /** Any non-customer membership, or a platform admin — the shell's tier. */
  const requireStaffTier = async (actor: RbacActor): Promise<void> => {
    if (actor.isSuper) return;
    if (!actor.userId) throw new RbacApiError(403, messages.forbidden);
    const role = actor.role ?? (await team.getMemberRole(actor.tenantId, actor.userId));
    if (!role || role === customerRole) {
      throw new RbacApiError(403, messages.forbidden);
    }
  };

  return {
    routes: [
      ...roleRoutes({ config, guards, governance, roles, wire, requireStaffTier }),
      ...teamRoutes({ config, guards, governance, roles, team, wire }),
    ],
    guards,
    engine,
    governance,
    roles,
    team,
    async seedTenantRoles(tenantId: string): Promise<void> {
      const db = await config.db();
      await db.role.createMany({
        data: tenantRoleSeedRows(tenantId, config.tenantRoleSeeds),
        skipDuplicates: true,
      });
    },
  };
}
