/// <reference types="vite/client" />
import { posix } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The point of `@12-apps/ui/form/Input/outlined` (FUT-1054) is what it does NOT
 * import: MUI's `FilledInput` and `Input`. A bundler keeps both for any caller
 * of the generic field, because its variant is chosen at runtime.
 *
 * So this walks the relative-import graph from the outlined entry, and from
 * `CepField` (which renders it), and refuses either module. Every source module
 * is its own dist entry (`scripts/build-entries.mjs`), so the source graph is
 * the graph a consumer's bundler sees. One stray `import … from '../Input'`, or
 * a factory that imports the generic table, and the variants are back.
 *
 * The sources come in through the bundler (`?raw`), keyed by their path from
 * the package root, so the walk touches no file system at test time.
 */
const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/__tests__/**', '!/src/**/*.stories.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
/** Where the components live, as the glob keys spell it. */
const COMPONENTS = '/src/components';
const FORBIDDEN = ['@mui/material/FilledInput/index.js', '@mui/material/Input/index.js'];

const SPECIFIER = /(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

/** Every runtime import of a module: type-only imports are erased and do not count. */
function runtimeImports(file: string): string[] {
  const out: string[] = [];
  for (const match of (SOURCES[file] ?? '').matchAll(SPECIFIER)) {
    if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
    const specifier = match[1] ?? match[2];
    if (specifier) out.push(specifier);
  }
  return out;
}

function resolveRelative(from: string, specifier: string): string {
  const base = posix.join(posix.dirname(from), specifier);
  const spelled = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  const found = spelled.find((path) => path in SOURCES);
  if (!found) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return found;
}

/** The package imports reachable from `entry` through relative imports. */
function reachablePackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith('.')) stack.push(resolveRelative(file, specifier));
      else packages.add(specifier);
    }
  }
  return packages;
}

describe.each([
  ['the outlined Input entry', 'form/Input/outlined/index.ts'],
  ['CepField', 'form/CepField/index.ts'],
])('%s', (_name, entry) => {
  const packages = reachablePackages(`${COMPONENTS}/${entry}`);

  it('reaches OutlinedInput', () => {
    expect(packages).toContain('@mui/material/OutlinedInput/index.js');
  });

  it.each(FORBIDDEN)('never reaches %s', (forbidden) => {
    expect(packages).not.toContain(forbidden);
  });
});

describe('the generic Input entry', () => {
  it('still reaches all three MUI inputs (the walk is not vacuous)', () => {
    const packages = reachablePackages(`${COMPONENTS}/form/Input/index.ts`);
    for (const module of [...FORBIDDEN, '@mui/material/OutlinedInput/index.js']) {
      expect(packages).toContain(module);
    }
  });
});
