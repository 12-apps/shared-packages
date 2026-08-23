/**
 * The permission CEILING an impersonated request may never exceed.
 *
 * `./guards.ts` already CONSUMES a ceiling: it intersects the resolved set with
 * it, and forces `isSuper` off whenever one is present, because a host that
 * carried a ceiling and forgot that line would get the UNION rather than the
 * narrowing. What no host could reach was the other half — COMPUTING the
 * ceiling — so each one wrote the three-row table itself, against this
 * package's own `getTenantRolesByName`, `expandRole` and `WILDCARD`. The two
 * ends of one rule lived in two repositories.
 *
 * THE SHAPE OF THE FEATURE, in one place:
 *
 *   kind                | subject asked of the engine | ceiling
 *   --------------------|-----------------------------|-------------------------
 *   operator            | the TARGET user             | none — be exactly them
 *   preview, member     | the previewed MEMBER        | the ACTOR's own set
 *   preview, role       | the actor themselves        | the previewed ROLE's set
 *
 * The operator row has no ceiling on purpose: a support admin reproducing a
 * ticket must see precisely what the target sees, neither more (their platform
 * authority is forced off by the guards) nor less. The two preview rows DO have
 * one, because a preview is a tenant-side lens on the actor's own account — it
 * may only ever NARROW, never hand its owner a permission they do not genuinely
 * hold. Whichever row applies, the answer is bounded above by something the
 * actor was already entitled to.
 *
 * Across ALL THREE rows a session reaches only the tenant it was started for —
 * {@link outsideBoundedTenant}.
 */

import { expandRole, WILDCARD } from '../core/roles';
import type { RoleDef } from '../core/types';
import type { RbacDbProvider } from './db';
import { getTenantRolesByName } from './engine';
import { tenantRoleKey } from './permissions-format';

/** No inheritance: a tenant role row composes the catalog directly. */
const NO_INHERITED_ROLES: ReadonlyMap<string, RoleDef> = new Map();

/** Nothing is reachable — the deny-everything ceiling. */
const NOTHING: ReadonlySet<string> = new Set();

/**
 * The impersonation in force, reduced to what a ceiling depends on.
 *
 * Structural, and deliberately not the decoded cookie: a host collapses its own
 * union once and every consumer reads the same fields.
 */
export interface CeilingImpersonation {
  /**
   * `operator` is the unbounded platform kind; anything else is a preview. A
   * host whose audit trail spells that kind differently adapts at its own
   * seam — the DISTINCTION is what matters here, not the word, and a package
   * carrying an adopter's vocabulary is one no second adopter can read.
   */
  kind: 'operator' | 'preview';
  /** The one tenant this session is bounded to. */
  tenantId: string;
  /** The real human whose credentials authorized the request. */
  realUserId: string;
  /** The previewed role, for a ROLE preview; `null` for every other kind. */
  previewRoleName: string | null;
}

/**
 * Is this decision being made in a DIFFERENT tenant than the session was
 * started (and audited) for?
 *
 * A session names ONE tenant precisely so that acting as someone in a second
 * store is a second, separately audited start.
 *
 * `isUnboundedScope` is the host's: scopes that are not tenants at all (a
 * global scope, an organisation scope) are the app shell's own reads — "which
 * stores does this person belong to" — which resolve against the SUBJECT's
 * grants like everything else. Refusing them would break the shell around an
 * otherwise valid session. A tenant decision always passes a bare tenant id,
 * so the exemption is never taken on that path.
 */
export function outsideBoundedTenant(
  impersonation: Pick<CeilingImpersonation, 'tenantId'>,
  scope: string,
  isUnboundedScope: (scope: string) => boolean,
): boolean {
  if (isUnboundedScope(scope)) return false;
  return scope !== impersonation.tenantId;
}

export interface ImpersonationCeilingConfig {
  /** The RBAC database, for reading the previewed role's own row. */
  db: RbacDbProvider;
  /**
   * Every permission id in the host's catalog — what a WILDCARD role previews
   * as before it is intersected back down.
   */
  catalogPermissions: () => readonly string[];
  /** The actor's OWN resolved set in a scope (the engine's `getPermissions`). */
  actorPermissions: (userId: string, scope: string) => Promise<ReadonlySet<string>>;
  /** Which scopes the tenant bound does not apply to. */
  isUnboundedScope: (scope: string) => boolean;
  /**
   * Warm a scope cache before the actor read, when the host has one.
   *
   * Org-scope grants can vanish silently from a cold cache, and a ceiling
   * computed from a set that is missing them REVOKES rights the actor really
   * holds — a narrowing that is wrong in the safe-looking direction, which is
   * why it is worth a port rather than a comment.
   */
  warmScope?: (scope: string) => Promise<void>;
}

/**
 * The permission strings a previewed ROLE grants, read from the tenant's own
 * role row.
 *
 * The DB row is the authority, not an in-code template catalog: a tenant owns a
 * first-class row per role, including per-tenant overrides of seeded templates,
 * and resolving the preview anywhere else would show the owner a role that does
 * not exist in their store. An unknown or archived name resolves to the EMPTY
 * set — a preview that grants nothing, which is deny-by-default and visibly
 * wrong to the operator, rather than a silent fallback granting more than the
 * row says.
 *
 * Caveats are intentionally flattened away. This set is only ever a CEILING,
 * intersected with a set the engine produced with the caveats already
 * evaluated, so keeping them would re-check the same conditions against an
 * empty context and narrow twice.
 */
async function rolePermissions(
  config: ImpersonationCeilingConfig,
  tenantId: string,
  roleName: string,
): Promise<ReadonlySet<string>> {
  const roles = await getTenantRolesByName(config.db, [{ clientId: tenantId, name: roleName }]);
  const permissions = roles.get(tenantRoleKey(tenantId, roleName));
  if (permissions === undefined) return new Set();
  const expanded = expandRole({ name: roleName, permissions }, NO_INHERITED_ROLES);
  // A wildcard role previews as the whole catalog, which then intersects down
  // to whatever the actor actually holds — a preview of "the owner" is exactly
  // the actor's own set, never more.
  return expanded === WILDCARD
    ? new Set<string>(config.catalogPermissions())
    : new Set(expanded.keys());
}

/**
 * Build the ceiling resolver. Answers `null` when nothing narrows.
 *
 * The MEMBER-preview ceiling is resolved WITHOUT the caller's attribute bag on
 * purpose: a caveat evaluated against an empty context fails, so an omitted
 * attribute DROPS the permission from the ceiling rather than adding it. A
 * ceiling that errs is required to err narrow.
 */
export function createImpersonationCeiling(config: ImpersonationCeilingConfig) {
  return async function impersonationCeiling(
    impersonation: CeilingImpersonation | null,
    scope: string,
  ): Promise<ReadonlySet<string> | null> {
    if (!impersonation) return null;
    if (outsideBoundedTenant(impersonation, scope, config.isUnboundedScope)) return NOTHING;
    if (impersonation.kind === 'operator') return null;
    if (impersonation.previewRoleName !== null) {
      return rolePermissions(config, impersonation.tenantId, impersonation.previewRoleName);
    }
    await config.warmScope?.(scope);
    return config.actorPermissions(impersonation.realUserId, scope);
  };
}
