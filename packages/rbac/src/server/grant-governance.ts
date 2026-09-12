import { validateGrant, type GovernanceCatalog } from '../governance';
import type { RoleDef } from '../core/types';

import {
  GLOBAL_SCOPE,
  RbacApiError,
  fencedAudit,
  messagesOf,
  type RbacActor,
  type RbacAuditSink,
  type RbacMessages,
  type RbacServerConfig,
} from './context';
import { isOrgScope, getTenantRolesByName } from './engine';
import type { RbacGuards } from './guards';
import type { RbacDbProvider } from './db';
import { tenantRoleKey } from './permissions-format';

/**
 * Shared role-grant governance (12-13) — ported from the origin host's
 * `lib/rbac/grant-governance.ts`: the single source of truth for "may THIS
 * actor grant THIS role at THIS tenant?", reused by the member-role route and
 * the role CRUD routes so the surfaces can never diverge.
 *
 * Runs the pure {@link validateGrant} against the actor's own permission set
 * at the tenant scope: it blocks privilege escalation, scope-ceiling
 * violations, separation-of-duties and owner-protected roles. On a rejection
 * the machine reason is mapped to a user-safe message and thrown as a 400
 * {@link RbacApiError}, after the denial is reported to the audit sink (a
 * blocked escalation is exactly the event an owner most wants surfaced).
 */

/**
 * How many missing ids the escalation copy names before it counts the rest.
 *
 * Ten is above every realistic case a human is meant to act on — the incident
 * this came from had four — and far below the ~60 a MANAGER refused ADMIN
 * would produce. `missingPermissions` carries the complete set for any caller
 * that wants it; this bound is on the SENTENCE, not on the data.
 */
const MAX_NAMED_PERMISSIONS = 10;

/**
 * Map a refusal onto the user-safe copy.
 *
 * Takes the VERDICT rather than its `reason` string, because the escalation
 * case has something to add to the sentence and reading it back out of the
 * machine line would mean parsing a message this function's whole job is to
 * replace.
 *
 * ## Why escalation names the ids and the other codes do not
 *
 * The copy is deliberately vague — a refusal that explains itself teaches a
 * caller how to probe the grant surface. Escalation is the one code where that
 * trade is wrong: the ids it names are the granter's OWN permission set
 * subtracted from a role they can already see in the picker, so it discloses
 * nothing they could not compute, and withholding it makes the refusal
 * unactionable. An admin told only "you lack permissions you do not hold" has
 * no way to learn WHICH, and the store cannot fix its own roles.
 *
 * Every other code stays a flat sentence: a scope ceiling, an SoD clash or an
 * owner marker would each disclose something about the CATALOG rather than
 * about the caller.
 */
function governanceMessage(
  messages: RbacMessages,
  verdict: { reason: string; missingPermissions?: readonly string[] },
): string {
  const code = verdict.reason.split(':')[0];
  switch (code) {
    case 'ESCALATION': {
      const missing = verdict.missingPermissions ?? [];
      // Falls back to the bare sentence when the set is somehow empty, so a
      // future refusal path that forgets to carry it degrades to today's
      // wording rather than to an empty parenthesis.
      if (missing.length === 0) return messages.governance.escalation;
      // CAPPED, because the set is unbounded: the reported case had four ids,
      // but a low-tier actor refused an administrator role is missing most of
      // the catalog, and sixty raw ids in a parenthesis is not a sentence a
      // person reads — it is the same unactionable refusal in a longer coat.
      // The overflow is a bare count rather than a word, so this stays correct
      // in every locale without the host supplying another string.
      const shown = missing.slice(0, MAX_NAMED_PERMISSIONS);
      const rest = missing.length - shown.length;
      const named = rest > 0 ? `${shown.join(', ')}, +${rest}` : shown.join(', ');
      return `${messages.governance.escalation} (${named})`;
    }
    case 'SCOPE_CEILING':
      return messages.governance.scopeCeiling;
    case 'SEPARATION_OF_DUTIES':
      return messages.governance.separationOfDuties;
    case 'OWNER_PROTECTED':
      return messages.governance.ownerProtected;
    case 'UNKNOWN_ROLE':
      return messages.governance.unknownRole;
    default:
      return messages.governance.fallback;
  }
}

export interface GrantGovernance {
  /**
   * Assert the actor may grant `roleName` at the tenant (a template name OR a
   * tenant custom role, judged by its composed permissions), or throw a 400.
   */
  assertCanGrantRole(actor: RbacActor, roleName: string, targetUserId?: string): Promise<void>;
  /**
   * Assert the actor may CREATE/EDIT a custom role with this exact permission
   * set (escalation / owner-marker / SoD / scope ceiling), or throw a 400.
   */
  assertCanCreateRole(
    actor: RbacActor,
    role: { name: string; permissions: readonly string[] | '*' },
  ): Promise<void>;
  /**
   * Assert the actor may OVERRIDE the seeded template `name` with this exact
   * effective set (curated-template mode: intrinsic owner-markers and SoD
   * pairs preserved; escalation still bites), or throw a 400.
   */
  assertCanOverrideTemplateRole(
    actor: RbacActor,
    role: { name: string; permissions: readonly string[] | '*' },
  ): Promise<void>;
  /** Assert `name` is a template a tenant may override (not an owner role). */
  assertEditableTemplateName(name: string): void;
  /** Whether `name` could carry a per-tenant override. */
  isOverridableTemplateName(name: string): boolean;
  /** Whether `name` is a seeded template name (reserved for custom roles). */
  isTemplateRoleName(name: string): boolean;
}

interface GovernanceCtx<P extends string> {
  db: RbacDbProvider;
  governance: GovernanceCatalog;
  guards: RbacGuards<P>;
  audit: RbacAuditSink | undefined;
  messages: RbacMessages;
}

/**
 * Record a DENIED role-management attempt: each rejection reports one
 * `governance.reject` entry before the user-safe error is thrown. The sink is
 * FENCED ({@link fencedAudit} in the factory below), so a failed log can never
 * turn the DENIAL (the security outcome) into a 500 — the deny stands.
 */
async function recordRejection<P extends string>(
  ctx: GovernanceCtx<P>,
  tenantId: string,
  verdict: { reason: string; missingPermissions?: readonly string[] },
  roleName: string,
  targetUserId?: string,
): Promise<void> {
  const missing = verdict.missingPermissions ?? [];
  await ctx.audit?.({
    clientId: tenantId,
    action: 'governance.reject',
    resourceType: 'governance',
    resourceId: roleName,
    after: {
      code: verdict.reason.split(':')[0] ?? verdict.reason,
      roleName,
      // The ids an ESCALATION turned on. The entry used to carry the code
      // alone, which told an owner reviewing the trail that a grant was
      // refused and nothing about what would have allowed it — and a blocked
      // escalation is the entry they are most likely to be reading.
      ...(missing.length > 0 ? { missingPermissions: [...missing] } : {}),
      ...(targetUserId ? { targetUserId } : {}),
    },
  });
}

/**
 * Resolve `roleName` to what the validator judges: a template NAME (looked up
 * in the catalog) or, for a tenant CUSTOM role, an inline {@link RoleDef} of
 * its composed permissions. The template path stays DB-free.
 */
async function resolveRoleForGrant<P extends string>(
  ctx: GovernanceCtx<P>,
  tenantId: string,
  roleName: string,
): Promise<string | RoleDef> {
  if (ctx.governance.roles.some((role) => role.name === roleName)) {
    return roleName;
  }
  const custom = await getTenantRolesByName(ctx.db, [{ clientId: tenantId, name: roleName }]);
  const permissions = custom.get(tenantRoleKey(tenantId, roleName));
  // Unknown (neither template nor custom) → leave the name; validateGrant
  // answers UNKNOWN_ROLE.
  return permissions === undefined ? roleName : { name: roleName, permissions };
}

async function judge<P extends string>(
  ctx: GovernanceCtx<P>,
  actor: RbacActor,
  roleBeingGranted: string | RoleDef,
  roleName: string,
  curatedTemplate: boolean,
  targetUserId?: string,
): Promise<void> {
  const grantScope = actor.tenantId;
  const isLeaf = grantScope !== GLOBAL_SCOPE && !isOrgScope(grantScope);
  const granterPermissions = await ctx.guards.getActorPermissions(
    { userId: actor.userId, isSuper: actor.isSuper, permissionCeiling: actor.permissionCeiling },
    actor.tenantId,
  );
  const verdict = validateGrant({
    granterPermissions,
    roleBeingGranted,
    targetScope: { isLeaf },
    catalog: ctx.governance,
    ...(curatedTemplate ? { curatedTemplate: true } : {}),
  });
  if (!verdict.ok) {
    await recordRejection(ctx, actor.tenantId, verdict, roleName, targetUserId);
    throw new RbacApiError(400, governanceMessage(ctx.messages, verdict));
  }
}

export function createGrantGovernance<P extends string>(
  config: RbacServerConfig<P>,
  guards: RbacGuards<P>,
): GrantGovernance {
  const ctx: GovernanceCtx<P> = {
    db: config.db,
    governance: config.catalog.governance,
    guards,
    audit: fencedAudit(config.audit),
    messages: messagesOf(config),
  };
  const templateNames = new Set(config.catalog.roleTemplates.map((role) => role.name));
  const overridableNames = new Set(
    config.catalog.roleTemplates
      .filter((role) => !config.catalog.governance.ownerRoles.includes(role.name))
      .map((role) => role.name),
  );

  return {
    async assertCanGrantRole(actor, roleName, targetUserId) {
      const resolved = await resolveRoleForGrant(ctx, actor.tenantId, roleName);
      await judge(ctx, actor, resolved, roleName, false, targetUserId);
    },
    async assertCanCreateRole(actor, role) {
      await judge(ctx, actor, { name: role.name, permissions: role.permissions }, role.name, false);
    },
    async assertCanOverrideTemplateRole(actor, role) {
      await judge(ctx, actor, { name: role.name, permissions: role.permissions }, role.name, true);
    },
    assertEditableTemplateName(name) {
      if (!overridableNames.has(name)) {
        throw new RbacApiError(400, ctx.messages.templateNotEditable);
      }
    },
    isOverridableTemplateName: (name) => overridableNames.has(name),
    isTemplateRoleName: (name) => templateNames.has(name),
  };
}
