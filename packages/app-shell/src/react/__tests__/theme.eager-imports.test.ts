import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * FUT-3008 — `createAppTheme`'s density branch used to call `@12-apps/ui/tokens`'s
 * own `densityThemeOptions` directly, which pulled `density.ts` and the three
 * `density-overrides*` modules onto the critical path of every host that imports
 * `createAppTheme` — including one that never sets a density at all (one
 * adopter's storefront, whose bundle budget this broke).
 *
 * `AppThemeOptions.densityTheme` now carries the implementation in, and this
 * package refers to `densityThemeOptions` only by TYPE. This is a SOURCE-level
 * check (read with `node:fs`, not a bundler): the two files' own text never
 * imports `densityThemeOptions` as a value, only as a type — modelled on
 * `packages/ui/src/tokens/__tests__/density-overrides.eager-imports.test.ts`
 * (FUT-2993), which guards the same regression one hop further down.
 */
const SOURCE_FILES = ['../theme.ts', '../theme-options.ts'] as const;

/**
 * Every `@12-apps/ui/tokens` import statement in the source, whether or not
 * it names `densityThemeOptions`.
 */
function tokenImportStatements(source: string): string[] {
  return source.match(/^import[^;]*from\s+['"]@12-apps\/ui\/tokens['"];?/gm) ?? [];
}

/** Whether a single import statement pulls `densityThemeOptions` in as a VALUE. */
function importsAsValue(statement: string): boolean {
  if (!statement.includes('densityThemeOptions')) return false;
  if (/^import\s+type\s/.test(statement)) return false; // the whole statement is type-only
  return !/\btype\s+densityThemeOptions\b/.test(statement); // a `{ type densityThemeOptions }` clause
}

function readSource(relativePath: string): string {
  // The claim is about the real source text on disk — a mocked fs would only
  // assert what this file put in it, defeating the guard's whole point.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('createAppTheme keeps densityThemeOptions a type-only import (FUT-3008)', () => {
  it.each(SOURCE_FILES)('%s never value-imports densityThemeOptions from @12-apps/ui/tokens', (relativePath) => {
    const source = readSource(relativePath);
    const offendingImport = tokenImportStatements(source).find(importsAsValue);
    expect(offendingImport).toBeUndefined();
  });
});
