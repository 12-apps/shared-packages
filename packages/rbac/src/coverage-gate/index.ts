import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  assertGuardsConfigured,
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
 * the origin host's `apps/web/scripts/rbac/coverage.ts` so a host's own script is
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

/** The protected escape hatch — the only way a surface stays ungated. */
export interface RbacCoverageExclusions {
  /** Server actions intentionally public/unauthenticated, name → reason. */
  actions: Record<string, string>;
  /** Route path prefixes intentionally public, prefix → reason. */
  routes: Record<string, string>;
}

/**
 * One route a PACKAGE declares through its wiring manifest, policy attached —
 * a structural twin of `@12-apps/wiring`'s `RoutePolicyRow` (restated here so
 * this gate depends on no sibling), with the path already in the `{param}`
 * form `urlPathOf` yields, so exclusion matching and messages speak one
 * grammar.
 *
 * A declared route has no file to grep: its protection IS the declaration.
 * The host's dispatcher enforces the declared policy (the wiring consumer
 * refuses the inconsistent shapes at adoption, and the host pins declaration
 * against enforcement in its own suite), so this gate's job shrinks to the
 * two things only it can see: that a declaration never SHADOWS a route file
 * (two sources of truth for one URL), and that an unauthenticated kind never
 * smuggles a permission.
 */
export interface DeclaredRoute {
  method: string;
  /** Absolute URL path, `{param}` form (`/api/admin/{tenantSlug}/reports`). */
  path: string;
  kind: 'authenticated' | 'webhook' | 'public';
  permission?: string;
  entitlement?: string;
  quota?: string;
}

export interface RbacCoverageOptions {
  /** The framework routes folder (the WHOLE `app`, never `app/api`). */
  appDir: string;
  /** Root for relative paths in failure messages. Default: `appDir`'s parent. */
  webRoot?: string;
  /** Path to the exclusions JSON ({@link RbacCoverageExclusions}). */
  exclusionsPath: string;
  /**
   * The identifiers this HOST accepts as an RBAC gate — its own guard helpers,
   * by name. Required, and it used to default to a hard-coded list of
   * the origin host's seventeen: a second host adopting the gate inherited another
   * application's vocabulary, so every one of its own guards read as "not a
   * guard" and every route it protects read as unprotected. There is no
   * generic answer here — the gate greps the host's source for the host's
   * names — so the field is the host's to state.
   *
   * What belongs on the list is a guard that carries an authenticated
   * identity. A tenant/session RESOLVER on a public route is not one.
   *
   * `[]` is REFUSED, loudly: it is the one value that cannot mean anything —
   * see {@link runRbacCoverage}.
   */
  rbacGuards: readonly string[];
  /**
   * Throwing entitlement guard identifiers — recognized ONLY to enforce the
   * sequencing invariant (auth 401 → RBAC 403 → entitlement 402). They never
   * count as RBAC protection: they carry no authenticated identity. Pass `[]`
   * for a host with no billing tier.
   */
  entitlementGuards: readonly string[];
  /**
   * Routes served WITHOUT a route file — declared by an adopted package's
   * wiring manifest and registered wholesale. Feed it
   * `routePolicyTable(assembled.routes)` (paths converted to `{param}`
   * form); each row is accounted protected-by-declaration.
   */
  declaredRoutes?: readonly DeclaredRoute[];
}

export interface RbacCoverageResult {
  failures: string[];
  routeFileCount: number;
  declaredRouteCount: number;
  actionCount: number;
}

/** The resolved option set every half of the gate reads. */
interface GateContext {
  appDir: string;
  webRoot: string;
  rbacGuards: readonly string[];
  entitlementGuards: readonly string[];
  exclusions: RbacCoverageExclusions;
  declaredRoutes: readonly DeclaredRoute[];
}

/**
 * Declared-route coverage. The routes have no files to grep; what CAN go
 * wrong lives in the declarations themselves and in their relationship to
 * the filesystem, and both directions fail loudly here.
 */
function declaredRouteFailures(
  ctx: GateContext,
  fileUrlPaths: ReadonlySet<string>,
  seenRoutePrefixes: Set<string>,
): string[] {
  const failures: string[] = [];
  const excludedRoutePrefixes = Object.keys(ctx.exclusions.routes);
  const seenDeclared = new Set<string>();
  for (const declared of ctx.declaredRoutes) {
    const key = `${declared.method.toUpperCase()} ${declared.path}`;
    if (seenDeclared.has(key)) {
      failures.push(`duplicate declared route: ${key} — one declaration per method+path`);
    }
    seenDeclared.add(key);
    if (fileUrlPaths.has(declared.path)) {
      failures.push(
        `declared route shadows a route file: ${declared.path} — one URL, one source of truth; ` +
          `delete the file or drop the declaration`,
      );
    }
    if (declared.kind !== 'authenticated' && declared.permission !== undefined) {
      failures.push(
        `${declared.kind} route with a permission: ${key} requires "${declared.permission}" — ` +
          `an unauthenticated route has no actor to check`,
      );
    }
    // A prefix exclusion matching a declared route is not stale — mark it
    // seen so the pruning check below stays honest across both sources.
    const matchedPrefix = segmentPrefixMatch(declared.path, excludedRoutePrefixes);
    if (matchedPrefix) seenRoutePrefixes.add(matchedPrefix);
  }
  return failures;
}

const SEQUENCING_TAIL =
  'an entitlement guard is the 402 axis and must run AFTER an RBAC guard; it does not authorize';

/** Route coverage — file-level (a route file is one URL surface). */
function routeFailures(ctx: GateContext): {
  failures: string[];
  routeFileCount: number;
  declaredRouteCount: number;
} {
  const excludedRoutePrefixes = Object.keys(ctx.exclusions.routes);
  const failures: string[] = [];
  const routeFiles = walkRouteFiles(ctx.appDir);
  const seenRoutePrefixes = new Set<string>();
  const fileUrlPaths = new Set<string>();

  for (const file of routeFiles) {
    const urlPath = urlPathOf(file, ctx.appDir);
    fileUrlPaths.add(urlPath);
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

  failures.push(...declaredRouteFailures(ctx, fileUrlPaths, seenRoutePrefixes));

  for (const prefix of excludedRoutePrefixes) {
    if (!seenRoutePrefixes.has(prefix)) {
      failures.push(
        `stale route exclusion: "${prefix}" — no route matches it; prune it from the exclusions file`,
      );
    }
  }
  return {
    failures,
    routeFileCount: routeFiles.length,
    declaredRouteCount: ctx.declaredRoutes.length,
  };
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

/**
 * Run the gate and return every violation (empty = green).
 *
 * @throws {Error} when `rbacGuards` is empty. A green run over a surface with
 * NO accepted guard is the one result this gate must never produce: the whole
 * verdict is "does this file call one of these names", so an empty list makes
 * every answer meaningless. It fails loudly at the option rather than quietly
 * at every file.
 */
export function runRbacCoverage(options: RbacCoverageOptions): RbacCoverageResult {
  assertGuardsConfigured(options.rbacGuards);
  const ctx: GateContext = {
    appDir: options.appDir,
    webRoot: options.webRoot ?? options.appDir,
    rbacGuards: options.rbacGuards,
    entitlementGuards: options.entitlementGuards,
    exclusions: JSON.parse(readFileSync(options.exclusionsPath, 'utf8')) as RbacCoverageExclusions,
    declaredRoutes: options.declaredRoutes ?? [],
  };
  const routes = routeFailures(ctx);
  const actions = actionFailures(ctx);
  return {
    failures: [...routes.failures, ...actions.failures],
    routeFileCount: routes.routeFileCount,
    declaredRouteCount: routes.declaredRouteCount,
    actionCount: actions.actionCount,
  };
}

/**
 * The CLI face: print the verdict and exit non-zero on violations. A host's
 * `scripts/rbac/coverage.ts` is then one import + one call.
 */
export function rbacCoverageCli(options: RbacCoverageOptions): void {
  const { failures, routeFileCount, declaredRouteCount, actionCount } = runRbacCoverage(options);
  if (failures.length > 0) {
    console.error(`[rbac:coverage] ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  const declared = declaredRouteCount > 0 ? ` + ${declaredRouteCount} declared route(s)` : '';
  console.log(
    `[rbac:coverage] OK — ${routeFileCount} route file(s)${declared} + ${actionCount} action(s) protected or excluded.`,
  );
}
