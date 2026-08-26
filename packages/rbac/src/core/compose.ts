/**
 * COMPOSITION — assembling one catalog out of many owners' contributions.
 *
 * The host is the assembler. It imports each package's exported contribution
 * plus its own domain's, calls {@link composePermissions}, binds its ROLE
 * policy with {@link ComposedPermissions.withRoles}, and passes the resulting
 * {@link RbacCatalog} into `createApiRbac` / `createWebRbac`. Nothing pushes
 * into a global registry and no package imports a sibling to discover ids —
 * composition is an argument, at one call site, in the host.
 *
 * Two properties this file exists to guarantee:
 *
 *  - **Collisions are loud.** Two sources contributing the same id throw at
 *    composition time, naming both. There is no last-write-wins: a silent
 *    overwrite would let one package's scope-kind quietly replace another's,
 *    which is the `instance` → `class` downgrade that fails open.
 *  - **The union survives.** `composePermissions(a, b, c)` returns a catalog
 *    typed with the UNION of every source's literal ids, so a role listing an
 *    off-catalog permission and a guard checking one are still compile errors
 *    in the host — the property the package used to get for free by owning
 *    the catalog itself.
 */
import type { GovernanceCatalog, SodPair } from '../governance';
import { tenantRoleSeeds, type TenantRoleSeed } from '../tenant-role-seeds';

import {
  assertIdsCoverSpecs,
  assertSpecDeclaresItself,
  RbacCatalogError,
} from './catalog-integrity';
import { resolveRbacCopy, type RbacCopyResolver, type RbacCopySource } from './copy';
import {
  mergeLabelVocabulary,
  type PermissionContribution,
  type PermissionOf,
  type RbacLabelVocabulary,
} from './contribution';
import { collectLabels, type CatalogEntry } from './label-vocabulary';
import type { PermissionKind, PermissionRegistry, RoleDef } from './types';

/**
 * The failure every check throws, re-exported from the module that owns those
 * checks so `RbacCatalogError` keeps the import path hosts already use.
 */
export {
  RbacCatalogError,
  type RbacCatalogErrorCode,
} from './catalog-integrity';

/**
 * The accessor every reader of {@link RbacCatalog.labels} goes through,
 * re-exported here so the import path is the one that already carries
 * `composePermissions`. It lives in `./label-vocabulary` with the merge it
 * performs — see that module for why the words are the one product of
 * composition that is not decided at composition.
 */
export { labelsOf } from './label-vocabulary';

/**
 * The host's ROLE policy — the half of governance no package can own.
 *
 * Every set here is REQUIRED, `[]` included. Each one only ever REMOVES
 * something (a scope, a seeded row, a grant), so an omitted set is
 * indistinguishable from a stated empty one at runtime and silently disables
 * the rule instead of failing. Writing `leafOnlyRoles: []` is a sentence about
 * this host; leaving it out is a sentence about nobody.
 */
export interface RbacRolePolicy<P extends string = string> {
  /** The seeded role templates. Typed against the composed union. */
  readonly roles: readonly RoleDef<P>[];
  /** Role names never grantable via a custom role (e.g. `OWNER`). */
  readonly ownerRoles: readonly string[];
  /**
   * Roles assignable only at a LEAF scope, never at an org/parent one — the
   * SCOPE_CEILING half `validateGrant` enforces. `GovernanceCatalog` has
   * always made this mandatory; optional here meant a host could skip it and
   * lose the ceiling with no diagnostic (a leaf-only role built purely of
   * `class` permissions is then assignable org-wide, since the instance-
   * permission backstop never fires for it).
   */
  readonly leafOnlyRoles: readonly string[];
  /**
   * Roles that are platform-only, so no tenant gets a seeded row for them.
   * Omitting it seeded EVERY tenant a row for the platform tier — a role name
   * the tenant's own admins can then see and hand out.
   */
  readonly platformOnlyRoles: readonly string[];
  /**
   * Presentation labels for the role names — a table, or a RESOLVER over a
   * tag-keyed pack.
   *
   * Widened alongside the segment vocabulary because they end up in the same
   * merged structure and are read by the same screens. Leaving this one plain
   * would have made a roster whose permission words followed the reader and
   * whose role names did not: one grid, two languages, which reads as a broken
   * translation rather than as a setting.
   *
   * The role NAMES are untouched — they are the ids `validateGrant` and the
   * seeded rows are keyed on.
   */
  readonly roleLabels?: RbacCopySource<Readonly<Record<string, string>>>;
}

/**
 * The assembled catalog — ONE object carrying everything the factories need
 * about permissions and roles, so a host cannot wire the registry from one
 * place and the governance from another and have them disagree.
 */
export interface RbacCatalog<P extends string = string> {
  /** Every id, in contribution order. Carries the union ({@link PermissionOf}). */
  readonly ids: readonly P[];
  /** The registry the engine and the wire validate against. */
  readonly permissions: PermissionRegistry<P>;
  /** The seeded role templates the engine's name index resolves. */
  readonly roleTemplates: readonly RoleDef<P>[];
  /** The catalog `validateGrant` enforces. */
  readonly governance: GovernanceCatalog;
  /** The rows `seedTenantRoles` materializes for a new tenant. */
  readonly tenantRoleSeeds: readonly TenantRoleSeed[];
  /**
   * Every contributed label, merged — as a RESOLVER the screens call.
   *
   * Not a value, and that is the whole of the change. A catalog is composed
   * ONCE per process: a host's `CATALOG` is a module-scope singleton its API
   * routes and its browser screens both import, so there is no per-reader
   * composition to hide a language in. Merging into a static structure here
   * would therefore pin every source's words to whatever language that module
   * was first evaluated in — invisibly, since a single-locale host cannot tell
   * the difference.
   *
   * So the merge stays lazy and each source's own {@link PermissionContribution.labels}
   * travels intact until a screen asks. Read it through {@link labelsOf}: a
   * resolver reached where a value was expected is a runtime `TypeError`, not a
   * type error.
   */
  readonly labels: RbacCopyResolver<RbacLabelVocabulary>;
  /** Which source contributed an id — diagnostics, and the collision message. */
  sourceOf(permission: string): string | undefined;
}

/** Permissions assembled but not yet bound to a role policy. */
export interface ComposedPermissions<P extends string = string> {
  readonly ids: readonly P[];
  readonly permissions: PermissionRegistry<P>;
  /** Owner markers, collected from every `ownerMarker: true` spec. */
  readonly ownerPermissions: readonly P[];
  /** SoD pairs, derived from every `separateFrom` declaration. */
  readonly sodPairs: readonly SodPair[];
  /** The merged vocabulary, as a resolver. See {@link RbacCatalog.labels}. */
  readonly labels: RbacCopyResolver<RbacLabelVocabulary>;
  sourceOf(permission: string): string | undefined;
  /** Bind the host's ROLE policy and get the catalog the factories take. */
  withRoles(policy: RbacRolePolicy<P>): RbacCatalog<P>;
}

/** Flatten the contributions, refusing a second claim on any id. */
function collectEntries(
  contributions: readonly PermissionContribution<string>[],
): CatalogEntry[] {
  const owner = new Map<string, string>();
  const entries: CatalogEntry[] = [];
  for (const contribution of contributions) {
    assertIdsCoverSpecs(contribution);
    contribution.ids.forEach((id) => {
      const previous = owner.get(id);
      if (previous !== undefined) {
        throw new RbacCatalogError(
          'PERMISSION_COLLISION',
          `permission "${id}" is contributed by both "${previous}" and "${contribution.source}" — exactly one source may own an id, so rename or drop the duplicate (composition never lets the later source win)`,
        );
      }
      const spec = contribution.permissions[id];
      if (!spec) {
        throw new RbacCatalogError(
          'UNKNOWN_PERMISSION',
          `"${contribution.source}" lists "${id}" among its ids but declares no spec for it`,
        );
      }
      assertSpecDeclaresItself(id, spec, contribution.source);
      owner.set(id, contribution.source);
      entries.push({ id, spec, source: contribution.source });
    });
  }
  return entries;
}

/** Derive the SoD pairs, validating every counterpart against the full set. */
function collectSodPairs(
  entries: readonly CatalogEntry[],
  known: ReadonlySet<string>,
): SodPair[] {
  const pairs: SodPair[] = [];
  const seen = new Set<string>();
  const add = (entry: CatalogEntry, counterpart: string): void => {
    if (!known.has(counterpart)) {
      throw new RbacCatalogError(
        'UNKNOWN_PERMISSION',
        `"${entry.id}" (from "${entry.source}") declares separateFrom "${counterpart}", which no source contributes`,
      );
    }
    // Either side may declare the pair; keying on the sorted names makes a
    // doubly-declared pair one pair rather than two mirrored ones.
    const key = [entry.id, counterpart].sort().join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([entry.id, counterpart]);
  };
  for (const entry of entries) {
    (entry.spec.separateFrom ?? []).forEach((counterpart) => {
      add(entry, counterpart);
    });
  }
  return pairs;
}

/** Every permission a role grants, wildcard excluded (nothing to check there). */
function roleGrants(role: RoleDef): readonly string[] {
  if (role.permissions === '*') return [];
  return role.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.permission,
  );
}

/**
 * The runtime half of the typed union: a role assembled from JSON, or from a
 * host that skipped the generic, still cannot grant an id nothing contributes.
 */
function assertRolesResolve(
  policy: RbacRolePolicy<string>,
  known: ReadonlySet<string>,
): void {
  const names = new Set(policy.roles.map((role) => role.name));
  const unknownRole = [
    ...policy.ownerRoles,
    ...policy.leafOnlyRoles,
    ...policy.platformOnlyRoles,
  ].find((name) => !names.has(name));
  if (unknownRole !== undefined) {
    throw new RbacCatalogError(
      'UNKNOWN_ROLE',
      `role policy names "${unknownRole}", which is not one of the ${policy.roles.length} role templates`,
    );
  }
  const stray = policy.roles.flatMap((role) =>
    roleGrants(role)
      .filter((permission) => !known.has(permission))
      .map((permission) => ({ role: role.name, permission })),
  )[0];
  if (stray !== undefined) {
    throw new RbacCatalogError(
      'UNKNOWN_PERMISSION',
      `role "${stray.role}" grants "${stray.permission}", which no source contributes`,
    );
  }
}

/** The untyped worker; `composePermissions` re-attaches the literal union. */
function composeUntyped(
  contributions: readonly PermissionContribution<string>[],
): ComposedPermissions<string> {
  const entries = collectEntries(contributions);
  const ids = entries.map((entry) => entry.id);
  const known = new Set(ids);
  const kinds = new Map<string, PermissionKind>(
    entries.map((entry) => [entry.id, entry.spec.kind]),
  );
  const sources = new Map(entries.map((entry) => [entry.id, entry.source]));
  const permissions: PermissionRegistry<string> = {
    list: ids,
    has: (permission): permission is string => known.has(permission),
    /**
     * The fallback stays, and it now means something different from what it
     * used to. `collectEntries` refuses a spec whose `kind` is not exactly
     * `'class'` or `'instance'`, so every CONTRIBUTED id is in this map: the
     * `??` can no longer convert an undeclared kind into `class`, which was
     * the whole of the fail-open. What is left is a permission NO source
     * contributes, where the {@link PermissionRegistry} contract answers
     * `'class'` (`definePermissions` does the same) and `has` is the question
     * to ask instead.
     *
     * Answering `'instance'` there was the alternative and is rejected on
     * purpose: an unknown id only ever reaches a decision through a WILDCARD
     * role, so the change would narrow an owner's `visible` to owned/assigned
     * rows and make `validateGrant` refuse a DB custom role carrying a stale
     * id at an org scope — a live behaviour change for ids that are already a
     * bug, in exchange for a gate that has nothing to gate.
     */
    kind: (permission) => kinds.get(permission) ?? 'class',
  };
  const ownerPermissions = entries
    .filter((entry) => entry.spec.ownerMarker === true)
    .map((entry) => entry.id);
  const sodPairs = collectSodPairs(entries, known);
  const labels = collectLabels(contributions, entries);
  const sourceOf = (permission: string): string | undefined =>
    sources.get(permission);

  return {
    ids,
    permissions,
    ownerPermissions,
    sodPairs,
    labels,
    sourceOf,
    withRoles(policy) {
      assertRolesResolve(policy, known);
      return {
        ids,
        permissions,
        roleTemplates: policy.roles,
        governance: {
          permissions,
          roles: policy.roles,
          ownerRoles: policy.ownerRoles,
          ownerPermissions,
          leafOnlyRoles: policy.leafOnlyRoles,
          sodPairs,
        },
        tenantRoleSeeds: tenantRoleSeeds(policy),
        // The host's role words layered on LAST, per reader, over the composed
        // vocabulary resolved for that same reader — so one grid cannot end up
        // half in one language.
        labels: (context) =>
          mergeLabelVocabulary(labels(context), {
            roles: resolveRbacCopy(policy.roleLabels ?? {}, context.locale),
          }),
        sourceOf,
      };
    },
  };
}

/**
 * Assemble one catalog from every source that owns part of it.
 *
 * @example
 * const CATALOG = composePermissions(
 *   RBAC_PERMISSIONS,          // @12-apps/rbac's own screens and endpoints
 *   LIFECYCLE_PERMISSIONS,     // another package's surfaces
 *   SHOP_PERMISSIONS,          // this host's domain
 * ).withRoles({
 *   roles: SHOP_ROLES,
 *   ownerRoles: ['OWNER'],
 *   leafOnlyRoles: ['MANAGER'],
 * });
 * type ShopPermission = PermissionOf<typeof CATALOG>;
 *
 * @throws {RbacCatalogError} on a duplicated id, an SoD counterpart nothing
 * contributes, a role naming an unknown permission, or a policy naming an
 * unknown role.
 */
export function composePermissions<
  const C extends readonly PermissionContribution<string>[],
>(...contributions: C): ComposedPermissions<PermissionOf<C[number]>> {
  // The worker is string-keyed because the runtime has no literals to keep;
  // the cast re-attaches the union the signature already proved.
  return composeUntyped(contributions) as ComposedPermissions<
    PermissionOf<C[number]>
  >;
}
