import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  callsEntitlementGuard,
  entitlementGuardedSymbols,
  guardedSymbols,
  isRbacProtected,
} from './detect';
import {
  exportedActionsOf,
  segmentPrefixMatch,
  urlPathOf,
  walkActionFiles,
  walkRouteFiles,
} from './surface-scan';

/**
 * `@12-apps/rbac/coverage` — the RBAC coverage gate (12-13), moved from
 * future-pay's `apps/web/scripts/rbac/coverage.ts` so a host's own script is
 * a one-line re-export and the CI workflow that shells out to the consumer's
 * `rbac:coverage` package script keeps working unchanged.
 *
 * The gate fails when a privileged surface ships without RBAC enforcement:
 * every `app/**` `route.ts` handler file and every `app/**` `*actions.ts`
 * server-action file must reference one of the accepted RBAC guards, OR be
 * listed (with a reason) in the protected exclusions file. Granularity:
 * ROUTES are checked file-level; ACTIONS per exported symbol (the piggyback
 * defense). It also enforces the SEQUENCING invariant — auth 401 → RBAC 403 →
 * entitlement 402: an entitlement guard without an RBAC guard fails, excluded
 * (public) surfaces included.
 */

export {
  callsEntitlementGuard,
  entitlementGuardedSymbols,
  guardedSymbols,
  isActionProtected,
  isRbacProtected,
  stripCommentsAndStrings,
} from './detect';
export type { ExportHeadGrammar } from './surface-scan';
export {
  exportedActionsOf,
  exportedNamesOf,
  segmentPrefixMatch,
  urlPathOf,
  walkActionFiles,
  walkRouteFiles,
} from './surface-scan';

/**
 * The RBAC guard identifiers the future-pay host accepts — the DEFAULT list,
 * overridable per host. Note what is deliberately ABSENT there: tenant/session
 * RESOLVERS for public storefront routes are not authorization gates.
 */
export const FUTURE_PAY_RBAC_GUARDS: readonly string[] = [
  'requireTenantAnyPermissionBySlug',
  'requireTenantPermissionBySlug',
  'requireTenantListBySlug',
  'requireTenantStaffBySlug',
  'requireTenantAdminBySlug',
  'requireTenantOwnerBySlug',
  'resolveAdminTenantId',
  'requirePermission',
  'requireTenantOwner',
  'requireTenantAdmin',
  'requireTenantRole',
  'requireSessionUser',
  'requireSuperadmin',
  'assertCanGrantRole',
  'canUploadImages',
  'requireKitchenReadBySlug',
  'authorizeTenantTopics',
];

/**
 * The throwing entitlement guards — recognized ONLY to enforce sequencing;
 * they NEVER count as RBAC protection (they carry no authenticated identity).
 */
export const FUTURE_PAY_ENTITLEMENT_GUARDS: readonly string[] = [
  'requireEntitlement',
  'requireQuota',
  'requireImpersonationPreview',
];

/** The protected escape hatch — the only way a surface stays ungated. */
export interface RbacCoverageExclusions {
  /** Server actions intentionally public/unauthenticated, name → reason. */
  actions: Record<string, string>;
  /** Route path prefixes intentionally public, prefix → reason. */
  routes: Record<string, string>;
}

export interface RbacCoverageOptions {
  /** The framework routes folder (the WHOLE `app`, never `app/api`). */
  appDir: string;
  /** Root for relative paths in failure messages. Default: `appDir`'s parent. */
  webRoot?: string;
  /** Path to the exclusions JSON ({@link RbacCoverageExclusions}). */
  exclusionsPath: string;
  /** Accepted RBAC guard identifiers. Default: the future-pay list. */
  rbacGuards?: readonly string[];
  /** Throwing entitlement guard identifiers. Default: the future-pay list. */
  entitlementGuards?: readonly string[];
}

export interface RbacCoverageResult {
  failures: string[];
  routeFileCount: number;
  actionCount: number;
}

/** The resolved option set every half of the gate reads. */
interface GateContext {
  appDir: string;
  webRoot: string;
  rbacGuards: readonly string[];
  entitlementGuards: readonly string[];
  exclusions: RbacCoverageExclusions;
}

const SEQUENCING_TAIL =
  'an entitlement guard is the 402 axis and must run AFTER an RBAC guard; it does not authorize';

/** Route coverage — file-level (a route file is one URL surface). */
function routeFailures(ctx: GateContext): { failures: string[]; routeFileCount: number } {
  const excludedRoutePrefixes = Object.keys(ctx.exclusions.routes);
  const failures: string[] = [];
  const routeFiles = walkRouteFiles(ctx.appDir);
  const seenRoutePrefixes = new Set<string>();

  for (const file of routeFiles) {
    const urlPath = urlPathOf(file, ctx.appDir);
    const source = readFileSync(file, 'utf8');
    const protectedByRbac = isRbacProtected(source, ctx.rbacGuards);
    // Sequencing invariant — checked for EVERY route file, excluded (public)
    // prefixes included: a public route growing a throwing entitlement guard
    // would 402 plan details to unauthenticated callers.
    if (callsEntitlementGuard(source, ctx.entitlementGuards) && !protectedByRbac) {
      failures.push(
        `entitlement guard without RBAC guard: ${urlPath} (${relative(ctx.webRoot, file)}) — ${SEQUENCING_TAIL}`,
      );
    }
    const matchedPrefix = segmentPrefixMatch(urlPath, excludedRoutePrefixes);
    if (matchedPrefix) {
      seenRoutePrefixes.add(matchedPrefix);
      continue;
    }
    if (!protectedByRbac) {
      failures.push(
        `unprotected route: ${urlPath} (${relative(ctx.webRoot, file)}) — call an RBAC guard ` +
          `(${ctx.rbacGuards.slice(0, 3).join(' / ')} …; entitlement guards do NOT count), or ` +
          `(human-authorized) add a routes prefix to the exclusions file with a reason`,
      );
    }
  }

  for (const prefix of excludedRoutePrefixes) {
    if (!seenRoutePrefixes.has(prefix)) {
      failures.push(
        `stale route exclusion: "${prefix}" — no route matches it; prune it from the exclusions file`,
      );
    }
  }
  return { failures, routeFileCount: routeFiles.length };
}

/** Action coverage — per exported symbol (the piggyback defense). */
function actionFailures(ctx: GateContext): { failures: string[]; actionCount: number } {
  const failures: string[] = [];
  const actionRecords = walkActionFiles(ctx.appDir).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const guarded = guardedSymbols(source, ctx.rbacGuards);
    const entitled = entitlementGuardedSymbols(source, ctx.entitlementGuards);
    return exportedActionsOf(source).map((action) => ({
      action,
      file,
      guarded: guarded.has(action),
      entitled: entitled.has(action),
    }));
  });
  const allActions = new Set(actionRecords.map((r) => r.action));

  for (const { action, file, guarded, entitled } of actionRecords) {
    if (entitled && !guarded) {
      failures.push(
        `entitlement guard without RBAC guard: ${action} (${relative(ctx.webRoot, file)}) — ${SEQUENCING_TAIL}`,
      );
    }
    if (guarded || action in ctx.exclusions.actions) continue;
    failures.push(
      `unprotected server action: ${action} (${relative(ctx.webRoot, file)}) — gate it with an ` +
        `RBAC guard (entitlement guards do NOT count), or (human-authorized) add it to the exclusions file with a reason`,
    );
  }

  for (const action of Object.keys(ctx.exclusions.actions)) {
    if (!allActions.has(action)) {
      failures.push(
        `stale action exclusion: ${action} — the action no longer exists; prune it from the exclusions file`,
      );
    }
  }
  return { failures, actionCount: allActions.size };
}

/** Run the gate and return every violation (empty = green). */
export function runRbacCoverage(options: RbacCoverageOptions): RbacCoverageResult {
  const ctx: GateContext = {
    appDir: options.appDir,
    webRoot: options.webRoot ?? options.appDir,
    rbacGuards: options.rbacGuards ?? FUTURE_PAY_RBAC_GUARDS,
    entitlementGuards: options.entitlementGuards ?? FUTURE_PAY_ENTITLEMENT_GUARDS,
    exclusions: JSON.parse(readFileSync(options.exclusionsPath, 'utf8')) as RbacCoverageExclusions,
  };
  const routes = routeFailures(ctx);
  const actions = actionFailures(ctx);
  return {
    failures: [...routes.failures, ...actions.failures],
    routeFileCount: routes.routeFileCount,
    actionCount: actions.actionCount,
  };
}

/**
 * The CLI face: print the verdict and exit non-zero on violations. A host's
 * `scripts/rbac/coverage.ts` is then one import + one call.
 */
export function rbacCoverageCli(options: RbacCoverageOptions): void {
  const { failures, routeFileCount, actionCount } = runRbacCoverage(options);
  if (failures.length > 0) {
    console.error(`[rbac:coverage] ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    `[rbac:coverage] OK — ${routeFileCount} route file(s) + ${actionCount} action(s) protected or excluded.`,
  );
}
