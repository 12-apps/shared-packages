import { describe, expect, it } from 'vitest';

/**
 * The framework/browser boundary gate for the SERVER entry — the mirror of
 * `src/react/__tests__/boundary.test.ts`.
 *
 * `hono` is an OPTIONAL peer, imported only by `src/hono/index.ts`; `react`
 * and `@12-apps/ui` belong to the `./react` entry alone. Both facts are
 * load-bearing for an adopter taking `./server` without Hono (or without a
 * browser at all) — and `hono` is a devDependency here, so a stray
 * `import { Hono } from 'hono'` in `src/server/*` would pass lint, typecheck
 * and every runtime suite while silently breaking that story. Structural,
 * because only the source shows a type-only import a bundler would follow.
 */

/** Specifiers the server entry must never resolve. */
const FORBIDDEN = ['hono', 'react', 'react-dom', '@12-apps/ui'];

/** The `?raw` glob helper Vite injects; declared locally to avoid `any`. */
interface RawGlob {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}

// eslint-disable-next-line test-flakiness/no-unmocked-fs -- not a filesystem call: `import.meta.glob` is erased by Vite at transform time and the contents are inlined into the bundle, so nothing is read while the test runs. The rule matches the identifier `glob`.
const SERVER_SOURCES = (import.meta as unknown as RawGlob).glob('../*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier !== undefined);
}

describe('server entry stays framework-free', () => {
  it('has files to check (guards against a silently empty scan)', () => {
    expect(Object.keys(SERVER_SOURCES).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SERVER_SOURCES).map(([moduleId, source]) => ({
    name: moduleId.split('/').pop() ?? moduleId,
    source,
  })))('$name imports no web framework or browser surface', ({ source }) => {
    for (const specifier of importsOf(source)) {
      expect(
        FORBIDDEN.some((f) => specifier === f || specifier.startsWith(`${f}/`)),
        `forbidden from ./server: "${specifier}"`,
      ).toBe(false);
    }
  });
});
