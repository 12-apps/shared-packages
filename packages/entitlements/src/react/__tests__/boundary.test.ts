import { describe, expect, it } from 'vitest';

/**
 * The browser-boundary gate.
 *
 * `@12-apps/entitlements/react` may import TYPES and PURE functions from `core`
 * only — never a port, an adapter or the engine. Without this test the rule
 * rots in a month: someone imports `createEntitlements` for convenience, the
 * host's DB wiring becomes reachable from the client entry, and the package
 * stops being safely bundleable.
 *
 * Structural, not behavioural — it inspects the source, because a runtime
 * import check cannot see a type-only import that a bundler would still follow.
 */

/** Modules that carry host wiring and must never reach the browser entry. */
const FORBIDDEN = ['core/engine', 'core/plans', 'core/registry', 'memory'];

/** Modules the React entry is allowed to reach. */
const ALLOWED = ['core/types', 'core/quota', 'plan-wire'];

/** The `?raw` glob helper Vite injects; declared locally to avoid `any`. */
interface RawGlob {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}

/**
 * The real, checked-in bytes of `src/react/*`, inlined at TRANSFORM time by
 * Vite rather than read from disk while the test runs.
 *
 * Reading the actual source IS the assertion here, so a mocked `fs` would make
 * the gate vacuous — it would stay green forever while the React entry quietly
 * grew an engine import. Resolving the same files through the bundler keeps the
 * real bytes under test with no filesystem call to mock, stub or race.
 */
// eslint-disable-next-line test-flakiness/no-unmocked-fs -- not a filesystem call: `import.meta.glob` is erased by Vite at transform time and the contents are inlined into the bundle, so nothing is read while the test runs. The rule matches the identifier `glob`.
const REACT_SOURCES = (import.meta as unknown as RawGlob).glob(
  '../*.{ts,tsx}',
  { query: '?raw', import: 'default', eager: true },
);

function sourceFiles(): { name: string; source: string }[] {
  // `moduleId`, not `path`: these are bundler module ids, and naming the
  // binding `path` reads (to a human and to the flakiness lint alike) like the
  // `node:path` module being used for real filesystem work.
  return Object.entries(REACT_SOURCES).map(([moduleId, source]) => ({
    name: moduleId.split('/').pop() ?? moduleId,
    source,
  }));
}

/**
 * Every module specifier this file imports from.
 *
 * `matchAll` over a per-call literal rather than a shared `/g` regex on
 * purpose: a hoisted global regex carries `lastIndex` from one call into the
 * next, so the second file scanned would resume mid-source and silently
 * under-report its imports — precisely how a structural gate decays into a
 * green no-op.
 */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier !== undefined);
}

describe('react entry does not reach host wiring', () => {
  it('has files to check (guards against a silently empty scan)', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())('$name imports no server surface', ({ source }) => {
    const parentImports = importsOf(source).filter((s) => s.startsWith('..'));
    for (const specifier of parentImports) {
      const normalized = specifier.replace(/^\.\.\//, '');
      expect(
        FORBIDDEN.some((f) => normalized.startsWith(f)),
        `host wiring reachable from React entry: "${specifier}"`,
      ).toBe(false);
      expect(
        ALLOWED.some((a) => normalized.startsWith(a)),
        `"${specifier}" is not on the allowed list (${ALLOWED.join(', ')})`,
      ).toBe(true);
    }
  });

  // 20s, not the 5s default: the entry now carries the createWebEntitlements
  // surface, whose @12-apps/ui imports make this dynamic import legitimately
  // slow when the whole repo's suites run in parallel — the assertion itself
  // is instant once the graph loads.
  it('exposes no engine/adapter factories at runtime', { timeout: 20_000 }, async () => {
    const entry: Record<string, unknown> = await import('../index');
    for (const banned of [
      'createEntitlements',
      'createMemorySource',
      'createMemoryUsage',
      'createMemoryCache',
      'definePlans',
      'defineFeatures',
    ]) {
      expect(entry[banned]).toBeUndefined();
    }
  });
});
