// @vitest-environment node
/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the
   subject: the coverage gate is a plain-node script that reads a host's
   checkout, so these tests build a miniature host on disk and run the real
   script against it. Every path is inside a per-test mkdtemp directory. */
/**
 * The coverage gate, run as a host runs it — `node
 * scripts/entitlements-coverage.mjs --config …` against a real file tree.
 *
 * The load-bearing case is the VACUITY one, reproduced from review: a host
 * whose pages live in `src/screens` (exactly what the configurable `pagesDir`
 * invites) used to parse ZERO routed exports against the hardcoded
 * `./pages/` prefix and exit 0 having proved nothing. The prefix is now
 * derived from `pagesDir`, and a parse that still finds nothing fails loudly.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/entitlements-coverage.mjs',
);

interface FixtureOptions {
  pagesDir?: string;
  wrapped?: boolean;
  config?: Record<string, unknown>;
}

/** A miniature host: one routed page, a catalog, an empty allowlist. */
function fixture({ pagesDir = 'src/screens', wrapped = false, config = {} }: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'entitlements-coverage-'));
  const segment = pagesDir.split('/').pop() ?? pagesDir;
  mkdirSync(join(root, pagesDir, 'orders'), { recursive: true });

  writeFileSync(
    join(root, 'src/routes.tsx'),
    `const OrdersPage = lazyRoute(() =>\n` +
      `  import("./${segment}/orders").then((m) => ({ default: m.OrdersPage })),\n` +
      `);\n`,
  );
  writeFileSync(
    join(root, pagesDir, 'orders/index.tsx'),
    wrapped
      ? `export const OrdersPage = withEntitlement("orders.core", Page);\n`
      : `export function OrdersPage() { return null; }\n`,
  );
  writeFileSync(
    join(root, 'features.ts'),
    `export const FEATURES = defineFeatures({\n  "orders.core": { onRevoke: "hide" },\n} as const);\n`,
  );
  writeFileSync(join(root, 'exceptions.json'), '{}\n');
  writeFileSync(
    join(root, 'coverage.config.json'),
    JSON.stringify({
      routesFile: 'src/routes.tsx',
      pagesDir,
      featuresFile: 'features.ts',
      exceptionsFile: 'exceptions.json',
      navFile: null,
      tenantSwitchFile: null,
      ...config,
    }),
  );
  return join(root, 'coverage.config.json');
}

/**
 * A host whose route tree is SPLIT: the entry file routes one page and imports
 * a second module that routes another. This is future-pay's shape (12-77) —
 * `routes.tsx` at its line ceiling, Configuração's routes moved into
 * `routes-config.tsx`.
 */
function splitFixture({ listBoth = false }: { listBoth?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'entitlements-coverage-split-'));
  mkdirSync(join(root, 'src/pages/orders'), { recursive: true });
  mkdirSync(join(root, 'src/pages/billing'), { recursive: true });

  writeFileSync(
    join(root, 'src/routes.tsx'),
    `import { ConfigRoutes } from "./routes-config";\n` +
      `const OrdersPage = lazyRoute(() =>\n` +
      `  import("./pages/orders").then((m) => ({ default: m.OrdersPage })),\n` +
      `);\n`,
  );
  // The SPLIT-OFF module, and the page only it routes. Unwrapped and not
  // allowlisted, so a gate that could see it would fail.
  writeFileSync(
    join(root, 'src/routes-config.tsx'),
    `const BillingPage = lazyRoute(() =>\n` +
      `  import("./pages/billing").then((m) => ({ default: m.BillingPage })),\n` +
      `);\n`,
  );
  writeFileSync(
    join(root, 'src/pages/orders/index.tsx'),
    `export const OrdersPage = withEntitlement("orders.core", Page);\n`,
  );
  writeFileSync(join(root, 'src/pages/billing/index.tsx'), `export function BillingPage() { return null; }\n`);
  writeFileSync(
    join(root, 'features.ts'),
    `export const FEATURES = defineFeatures({\n  "orders.core": { onRevoke: "hide" },\n} as const);\n`,
  );
  writeFileSync(join(root, 'exceptions.json'), '{}\n');
  writeFileSync(
    join(root, 'coverage.config.json'),
    JSON.stringify({
      routesFile: listBoth ? ['src/routes.tsx', 'src/routes-config.tsx'] : 'src/routes.tsx',
      pagesDir: 'src/pages',
      featuresFile: 'features.ts',
      exceptionsFile: 'exceptions.json',
      navFile: null,
      tenantSwitchFile: null,
    }),
  );
  return join(root, 'coverage.config.json');
}

function runGate(configPath: string) {
  const result = spawnSync(process.execPath, [SCRIPT, '--config', configPath], {
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the coverage gate against a real host tree', () => {
  it('reviewer fixture: a non-`pages` pagesDir finds the routed export and FAILS on the gap', () => {
    // One routed, unwrapped, un-allowlisted page under src/screens. The old
    // hardcoded `./pages/` prefix parsed nothing here and exited 0.
    const { status, output } = runGate(fixture());
    expect(status).toBe(1);
    expect(output).toContain('OrdersPage');
    expect(output).toContain('neither wrapped');
  });

  it('passes a wrapped page, still deriving the prefix from pagesDir', () => {
    const { status, output } = runGate(fixture({ wrapped: true }));
    expect(status).toBe(0);
    expect(output).toContain('1 gated page(s)');
  });

  it('refuses to be vacuous: zero parsed routed exports is a failure, not a pass', () => {
    // A prefix that matches nothing must name itself instead of proving
    // nothing — the same guard declaredConfigRoutes always carried.
    const { status, output } = runGate(
      fixture({ wrapped: true, config: { routesImportPrefix: './wrong/' } }),
    );
    expect(status).toBe(1);
    expect(output).toContain('vacuous');
  });

  it('treats an ABSENT navFile/tenantSwitchFile as a config error, not an opt-out', () => {
    // Silence must be a decision: `null` opts out (the cases above), while a
    // forgotten key fails before any check runs.
    const { status, output } = runGate(fixture({ wrapped: true, config: { navFile: undefined } }));
    expect(status).toBe(1);
    expect(output).toContain('navFile');
  });
});

describe('a route tree split across modules (12-77)', () => {
  it('refuses to run against a tree whose other routes module is unlisted', () => {
    // The defect, stated as a failure. `routes-config.tsx` routes BillingPage,
    // which is unwrapped and un-allowlisted — a gap this gate exists to catch.
    // Listing only the entry file, the gate used to parse OrdersPage, find it
    // wrapped, and exit 0: a complete parse of an incomplete input, reporting
    // a smaller number and passing. It now names the module it cannot see.
    const { status, output } = runGate(splitFixture());

    expect(status).toBe(1);
    expect(output).toContain('routes-config');
    expect(output).toContain('does not list');
  });

  it('sees every page once both modules are listed, and fails on the one that is ungated', () => {
    // The fix applied: `routesFile` takes the array, the split-off page comes
    // into view, and the gap it was hiding is what fails.
    const { status, output } = runGate(splitFixture({ listBoth: true }));

    expect(status).toBe(1);
    expect(output).toContain('BillingPage');
    expect(output).toContain('neither wrapped');
  });

  it('still accepts a single path, so every existing host config keeps working', () => {
    // `routesFile` as a string is the shape every host ships today. The array
    // is additive; this is the case that says so.
    const { status, output } = runGate(fixture({ wrapped: true }));

    expect(status).toBe(0);
    expect(output).toContain('1 gated page(s)');
  });

  it('rejects an empty array rather than passing over an unreadable config', () => {
    // The error path. An empty list parses zero routes, which the vacuity
    // guard would also catch — but it should be refused as a CONFIG error,
    // before any check runs, where the message can name the field.
    //
    // Asserting on the NEW sentence on purpose: the old validator rejected any
    // non-string, so a looser assertion passed against the unfixed script and
    // proved nothing about the array contract.
    const { status, output } = runGate(fixture({ wrapped: true, config: { routesFile: [] } }));

    expect(status).toBe(1);
    expect(output).toContain('non-empty array');
  });
});
