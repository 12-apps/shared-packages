import { readFileSync } from "node:fs";

import { exportedActionsOf, segmentPrefixMatch, walkActionFiles } from "@12-apps/rbac/coverage";

import { collectRouteMethods } from "./route-methods";

/**
 * `@12-apps/mcp/coverage` — the MCP route/action coverage gate (12-23), moved out
 * of future-pay's `apps/web/scripts/mcp/coverage.ts` so a host's own script is a
 * one-line re-export and the CI workflow that shells out to the consumer's
 * `mcp:coverage` package script (`12-apps/ci`'s `mcp-contract.yml`) keeps working
 * unchanged.
 *
 * `mcp:check` only proves the REGISTRY matches the committed manifest; nothing
 * stops a new route file, or a new server action, from shipping outside the
 * agent-exposable surface. This gate closes both:
 *
 *  1. **Route coverage** — every HTTP method exported by a route file must be
 *     registered in the host's MCP registry (or its path listed under `routes` in
 *     the exclusions file), and every registry entry must map back to a real route
 *     file exporting that method. A tool the manifest advertises but no route
 *     serves is a promise an agent cannot cash.
 *  2. **Action coverage** — every exported server action must be mapped to a
 *     registry operationId in the action map, or listed under `actions` in the
 *     exclusions file with a reason. New actions fail until mapped; stale entries
 *     fail until pruned, so neither file can rot.
 *
 * The exclusions file is the ONLY escape hatch, and keeping it a separate,
 * human-protected file is the point: an agent cannot silently exclude a new
 * route/action — it has to justify to a human why the capability is not exposed.
 */

/** One registry entry, as the host's MCP registry describes an endpoint. */
export interface McpRegistryEndpoint {
  method: string;
  /** URL path in `{param}` form — the same shape the scan produces. */
  path: string;
  operationId: string;
}

/** The protected exclusions file: every deliberate gate escape hatch. */
export interface McpCoverageExclusions {
  /** Server actions kept off the surface, name → reason. */
  actions: Record<string, string>;
  /** Route path prefixes kept off the surface, prefix → reason. */
  routes: Record<string, string>;
}

/** The action map: server action name → registry operationId. */
export interface McpActionMap {
  mapped: Record<string, string>;
}

export interface McpCoverageOptions {
  /** The framework routes folder (the WHOLE `app`, never `app/api`). */
  appDir: string;
  /** Root for relative paths in failure messages. Default: `appDir`. */
  webRoot?: string;
  /** The host's registry entries (its `endpoints` array). */
  endpoints: readonly McpRegistryEndpoint[];
  /** Path to the exclusions JSON ({@link McpCoverageExclusions}). */
  exclusionsPath: string;
  /**
   * Path to the action-map JSON ({@link McpActionMap}). Omit for a host with no
   * server actions at all — action coverage is then vacuous rather than a crash on
   * a file that was never written.
   */
  actionMapPath?: string;
}

export interface McpCoverageResult {
  failures: string[];
  routeMethodCount: number;
  actionCount: number;
}

interface GateContext {
  appDir: string;
  webRoot: string;
  endpoints: readonly McpRegistryEndpoint[];
  exclusions: McpCoverageExclusions;
  actionMap: McpActionMap | null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Route coverage — every served method registered, every registry entry served. */
function routeFailures(ctx: GateContext): { failures: string[]; routeMethodCount: number } {
  const failures: string[] = [];
  const infraPrefixes = Object.keys(ctx.exclusions.routes);
  const routeMethods = collectRouteMethods(ctx.appDir, ctx.webRoot);
  const registered = new Set(
    ctx.endpoints.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`),
  );

  const covered = routeMethods.filter(({ urlPath }) => !segmentPrefixMatch(urlPath, infraPrefixes));
  for (const { urlPath, method, file } of covered) {
    if (!registered.has(`${method} ${urlPath}`)) {
      failures.push(
        `unregistered route: ${method} ${urlPath} (${file}) — add a registry entry, or ` +
          `(human-authorized, for infra only) a routes prefix in the exclusions file`,
      );
    }
  }

  const served = new Set(
    routeMethods.map(({ method, urlPath }) => `${method} ${urlPath}`),
  );
  for (const endpoint of ctx.endpoints) {
    if (!served.has(`${endpoint.method.toUpperCase()} ${endpoint.path}`)) {
      failures.push(
        `registry entry without a route: ${endpoint.operationId} ` +
          `(${endpoint.method.toUpperCase()} ${endpoint.path}) — the manifest advertises a tool no route serves`,
      );
    }
  }

  return { failures, routeMethodCount: covered.length };
}

/**
 * Every action the host actually exports must be accounted for — mapped to a
 * registry operationId, or excluded with a reason. Neither silently.
 */
function unaccountedActions(
  ctx: GateContext,
  actions: Set<string>,
  mapped: Record<string, string>,
): string[] {
  const failures: string[] = [];
  for (const action of actions) {
    const isMapped = action in mapped;
    const isExcluded = action in ctx.exclusions.actions;
    if (!isMapped && !isExcluded) {
      failures.push(
        `unmapped server action: ${action} — map it to a registry operationId in the action ` +
          `map, or (human-authorized) add it to the exclusions file with a reason`,
      );
    }
    if (isMapped && isExcluded) {
      failures.push(
        `action both mapped and excluded: ${action} — remove it from one of the two files`,
      );
    }
  }
  return failures;
}

/**
 * The other direction, and the one that keeps both files from rotting: an entry
 * naming an action that no longer exists, or an operationId the registry does not
 * have. Adding the mapping is never enough — a stale line must go.
 */
function staleActionEntries(
  ctx: GateContext,
  actions: Set<string>,
  mapped: Record<string, string>,
): string[] {
  const failures: string[] = [];
  const operationIds = new Set(ctx.endpoints.map((endpoint) => endpoint.operationId));
  for (const [action, operationId] of Object.entries(mapped)) {
    if (!actions.has(action)) {
      failures.push(`stale action-map entry: ${action} — the action no longer exists`);
    }
    if (!operationIds.has(operationId)) {
      failures.push(`action-map points at unknown operationId: ${action} → ${operationId}`);
    }
  }
  for (const action of Object.keys(ctx.exclusions.actions)) {
    if (!actions.has(action)) {
      failures.push(`stale action exclusion: ${action} — the action no longer exists`);
    }
  }
  return failures;
}

/** Action coverage — every action mapped or excluded, and neither file stale. */
function actionFailures(ctx: GateContext): { failures: string[]; actionCount: number } {
  const mapped = ctx.actionMap?.mapped ?? {};
  const actions = new Set(
    walkActionFiles(ctx.appDir).flatMap((file) => exportedActionsOf(readFileSync(file, "utf8"))),
  );

  return {
    failures: [
      ...unaccountedActions(ctx, actions, mapped),
      ...staleActionEntries(ctx, actions, mapped),
    ],
    actionCount: actions.size,
  };
}

/** Run the gate and return every violation (empty = green). */
export function runMcpCoverage(options: McpCoverageOptions): McpCoverageResult {
  const ctx: GateContext = {
    appDir: options.appDir,
    webRoot: options.webRoot ?? options.appDir,
    endpoints: options.endpoints,
    exclusions: readJson<McpCoverageExclusions>(options.exclusionsPath),
    actionMap: options.actionMapPath ? readJson<McpActionMap>(options.actionMapPath) : null,
  };
  const routes = routeFailures(ctx);
  const actions = actionFailures(ctx);
  return {
    failures: [...routes.failures, ...actions.failures],
    routeMethodCount: routes.routeMethodCount,
    actionCount: actions.actionCount,
  };
}

/**
 * The CLI face: print the verdict and exit non-zero on violations. A host's
 * `scripts/mcp/coverage.ts` is then one import + one call, and the CI workflow that
 * runs `pnpm mcp:coverage` needs no change at all.
 */
export function mcpCoverageCli(options: McpCoverageOptions): void {
  const { failures, routeMethodCount, actionCount } = runMcpCoverage(options);
  if (failures.length > 0) {
    console.error(`[mcp:coverage] ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    `[mcp:coverage] OK — ${routeMethodCount} route method(s) registered, ` +
      `${actionCount} action(s) mapped/excluded.`,
  );
}

export {
  collectRouteMethods,
  exportedMethodsOf,
  HTTP_METHODS,
  type RouteMethod,
} from "./route-methods";
