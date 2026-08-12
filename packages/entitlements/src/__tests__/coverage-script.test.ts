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
