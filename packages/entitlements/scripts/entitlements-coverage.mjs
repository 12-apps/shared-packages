#!/usr/bin/env node
/* global console, process */
/**
 * Entitlement-gate coverage — the static gate that makes "ungated" a decision
 * instead of an omission.
 *
 * Page-side: the admin SPA's routed pages are enumerated from its routes file
 * and each one must either
 *
 *   - be wrapped with `withEntitlement("<feature>", …)` at its export, or
 *   - appear in the exceptions file with the REASON it stays open (money
 *     path, every-tier feature, tenant-switch surface, …).
 *
 * Cross-checks, all fatal:
 *   1. every routed page export is wrapped or allowlisted;
 *   2. every wrapped feature key is declared in the app catalog — a typo'd
 *      key would resolve `not-supported`, which the HOC deliberately renders
 *      UNLOCKED;
 *   3. every sidebar `requiredFeature` key is declared AND owned by a wrapped
 *      page — a crowned row must never land on an ungated page;
 *   4. stale allowlist lines (export gone, or now wrapped) fail, so the file
 *      only ever shrinks;
 *   5. every tenant-switch destination is a REAL declared config page — a
 *      stale entry would land the store on a catch-all with no switch on it.
 *
 * ## Configuration
 *
 * The gate is generic; the host names its own files in a JSON config:
 *
 *   node scripts/entitlements-coverage.mjs --config <path/to/config.json>
 *
 * All paths are resolved relative to the CONFIG FILE. Fields:
 *
 *   routesFile        (required)  the SPA's routes .tsx
 *   pagesDir          (required)  the pages directory the routes import from
 *   featuresFile      (required)  the file whose `defineFeatures(` call
 *                                 declares the app catalog
 *   exceptionsFile    (required)  the allowlist JSON ({ Export: "reason" })
 *   navFile           (optional)  the sidebar file carrying `requiredFeature:`
 *   tenantSwitchFile  (optional)  the `path:`-map of tenant-switch screens
 *   configRoutePrefix (optional)  the <Route path="..."> whose children are
 *                                 the config pages (default "config"); only
 *                                 used when tenantSwitchFile is set
 *
 * Plain node with ZERO dependencies, and that is a CONSTRAINT rather than a
 * convenience: CI callers may run this against a bare checkout with no
 * node_modules at all (12-apps/ci's entitlements-coverage.yml with
 * `install: false`). Note that once the HOST script is a re-export of this
 * file, the consumer's lane must install (the file itself still imports
 * nothing) — flip that workflow input when adopting the packaged copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

function fail(message) {
  console.error(`[entitlements:coverage] ${message}`);
  process.exit(1);
}

const configFlag = process.argv.indexOf("--config");
if (configFlag === -1 || process.argv[configFlag + 1] === undefined) {
  fail("usage: entitlements-coverage.mjs --config <path/to/config.json>");
}
const configPath = resolve(process.argv[configFlag + 1]);
const configDir = dirname(configPath);
const config = JSON.parse(readFileSync(configPath, "utf8"));

for (const required of ["routesFile", "pagesDir", "featuresFile", "exceptionsFile"]) {
  if (typeof config[required] !== "string" || config[required] === "") {
    fail(`config is missing required field "${required}".`);
  }
}

const at = (relativePath) => join(configDir, relativePath);
const read = (path) => readFileSync(path, "utf8");

/** routes file page imports: `import("./pages/<module>").then((m) => ({ default: m.<Export> }))`. */
function routedExports() {
  const source = read(at(config.routesFile));
  const pattern = /import\("\.\/pages\/([^"]+)"\)\s*\.then\(\(m\) => \(\{ default: m\.(\w+) \}\)\)/g;
  const seen = new Map();
  for (const match of source.matchAll(pattern)) {
    seen.set(match[2], match[1]);
  }
  return seen;
}

/** The feature key a module wraps `exportName` with, or null. */
function wrappedKeyOf(moduleSource, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = withEntitlement\\(\\s*"([^"]+)"`,
  );
  return pattern.exec(moduleSource)?.[1] ?? null;
}

/** Feature keys declared in the app catalog (the CODE layer). */
function declaredFeatures() {
  const source = read(at(config.featuresFile));
  const body = source.slice(source.indexOf("defineFeatures("));
  const keys = new Set();
  for (const match of body.matchAll(/^ {2}(?:"([\w.]+)"|([A-Za-z_]\w*)):\s*\{/gm)) {
    keys.add(match[1] ?? match[2]);
  }
  return keys;
}

/** `requiredFeature` keys the sidebar crowns by. */
function navFeatureKeys() {
  if (typeof config.navFile !== "string") return [];
  const source = read(at(config.navFile));
  return [...source.matchAll(/requiredFeature: "([\w.]+)"/g)].map((match) => match[1]);
}

/**
 * The `<prefix>/*` sub-paths the routes file declares as REAL pages.
 *
 * A redirect shim (`element={<Navigate …`) is excluded on purpose: linking a
 * store to one still "works", so it would satisfy the check below while
 * proving nothing about where a switch actually lives.
 */
function declaredConfigRoutes(prefix) {
  const source = read(at(config.routesFile));
  const block = source.slice(source.indexOf(`<Route path="${prefix}"`));
  const body = block.slice(0, block.indexOf("</Route>"));
  const paths = new Set();
  for (const match of body.matchAll(/<Route path="([\w-]+)" element=\{<(\w+)/g)) {
    if (match[2] !== "Navigate") paths.add(`${prefix}/${match[1]}`);
  }
  return paths;
}

/** Every destination the tenant-switch location map can send a store to. */
function tenantSwitchPaths() {
  const source = read(at(config.tenantSwitchFile));
  return [...source.matchAll(/path: "([\w/-]+)"/g)].map((match) => match[1]);
}

const failures = [];

const routes = routedExports();
const exceptions = JSON.parse(read(at(config.exceptionsFile)));
const features = declaredFeatures();

/** Page modules are directories (`index.tsx`) or plain files (`subpage.tsx`). */
function pageModuleSource(modulePath) {
  try {
    return read(at(join(config.pagesDir, modulePath, "index.tsx")));
  } catch {
    return read(at(join(config.pagesDir, `${modulePath}.tsx`)));
  }
}

const wrapped = new Map();
for (const [exportName, modulePath] of routes) {
  const moduleSource = pageModuleSource(modulePath);
  const key = wrappedKeyOf(moduleSource, exportName);
  if (key !== null) {
    wrapped.set(exportName, key);
    if (!features.has(key)) {
      failures.push(
        `${exportName} is wrapped with undeclared feature "${key}" — an unknown key resolves ` +
          `not-supported, which renders UNLOCKED. Declare it in ${config.featuresFile}.`,
      );
    }
    continue;
  }
  if (!(exportName in exceptions)) {
    failures.push(
      `${exportName} (${config.pagesDir}/${modulePath}) is routed but neither wrapped with ` +
        `withEntitlement() nor allowlisted in ${config.exceptionsFile} with a reason.`,
    );
  }
}

// The ratchet: a line must describe a page that still exists and is still open.
for (const exportName of Object.keys(exceptions)) {
  if (!routes.has(exportName)) {
    failures.push(
      `Stale allowlist line: "${exportName}" is not a routed page export any more — delete its line.`,
    );
  } else if (wrapped.has(exportName)) {
    failures.push(
      `Stale allowlist line: "${exportName}" is now wrapped with withEntitlement() — delete its line.`,
    );
  }
}

const wrappedKeys = new Set(wrapped.values());
for (const key of navFeatureKeys()) {
  if (!features.has(key)) {
    failures.push(`Sidebar requiredFeature "${key}" is not declared in the app catalog.`);
  }
  if (!wrappedKeys.has(key)) {
    failures.push(
      `Sidebar crowns by "${key}" but no routed page is wrapped with it — a crowned row must ` +
        `never land on an ungated page.`,
    );
  }
}

// A `disabled-by-tenant` row is the one denial a store can fix themselves, so
// both the plan page and the upsell prompt end by sending them to the screen
// holding the switch. That destination has to BE a screen: a config catch-all
// redirects an unknown path somewhere that "works", so a stale entry here
// would land the store on a working page with no such switch on it — quietly,
// which is the exact failure the location map exists to end.
if (typeof config.tenantSwitchFile === "string") {
  const prefix = typeof config.configRoutePrefix === "string" ? config.configRoutePrefix : "config";
  const configRoutes = declaredConfigRoutes(prefix);
  if (configRoutes.size === 0) {
    failures.push(
      `Parsed no ${prefix} routes out of ${config.routesFile} — the tenant-switch destination ` +
        `check below would be vacuous. Fix the parser, do not ignore this.`,
    );
  }
  for (const path of tenantSwitchPaths()) {
    // The bare prefix fallback is deliberate and always safe — it is the rail
    // itself, not a claim about which screen holds the switch.
    if (path === prefix) continue;
    if (!configRoutes.has(path)) {
      failures.push(
        `${config.tenantSwitchFile} points at "${path}", which ${config.routesFile} does not ` +
          `declare as a page — a store sent there hits the ${prefix} catch-all instead of the switch.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`[entitlements:coverage] ${failures.length} finding(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(
  `[entitlements:coverage] ok — ${wrapped.size} gated page(s), ` +
    `${Object.keys(exceptions).length} allowlisted with reasons, ${routes.size} routed exports.`,
);
