// The ROOT ENTRY may not reach a Node builtin.
//
// `@12-apps/payments-frontend`'s stories VALUE-import `@12-apps/payments-backend`,
// so Storybook bundles whatever the root barrel's module graph reaches. Reach
// `providers/shared.ts` and you reach its `import { createHash } from
// 'node:crypto'`, which Vite externalizes to `__vite-browser-external` — and
// the build dies with `"createHash" is not exported`, several files away from
// the export that caused it.
//
// The rule was already written, in as many words, in `src/index.ts`'s own
// docblock. FUT-764 broke it anyway: `providers/pagbank-legacy-resolve` went
// onto `providers/pagbank-public`, which IS on the root, and through
// `pagbank-legacy-notifications` it reached `shared.ts`. Lint, types, the unit
// suites and the consumer verification were all green; the seven-minute
// Storybook build was the only thing in the repo that noticed, and what it
// reported was a rollup stack trace naming a file nobody had touched.
//
// So the gate asserts the PROPERTY the docblock describes, in ~a second, and
// names the EDGE to cut rather than the symptom. Server-only capabilities keep
// shipping — at their own subpath, which no browser build reaches. That is the
// design the barrel already documents; this only makes it decidable.
//
// ## Why a graph walk and not a grep
//
// The offending file contained no `node:` import and no mention of crypto. What
// was wrong was a PATH: root → pagbank-public → pagbank-legacy-resolve →
// pagbank-legacy-notifications → shared → node:crypto. Only a walk can see
// that, and only a walk can print it, which is the difference between a gate
// somebody can act on and one they have to re-derive.
//
// ## Scope, stated plainly
//
// It walks the root entry alone. Subpath entries are deliberately unchecked —
// being reachable only from server code is exactly what they are for.
// Statement-level `import type` / `export type` are not edges (they are erased
// before any bundle exists); everything else is, which over-approximates in the
// safe direction: the gate can be stricter than the bundler, never looser.
import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const PACKAGE_ROOT = new URL('..', import.meta.url).pathname;
const ROOT_ENTRY = resolve(PACKAGE_ROOT, 'src/index.ts');
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

const BUILTINS = new Set(builtinModules);

/** A module specifier this bundle cannot have: `node:x`, or a bare builtin. */
function isNodeBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true;
  return BUILTINS.has(specifier);
}

/**
 * Every specifier the module imports at RUNTIME, in source order.
 *
 * A regex rather than a parser because this repo's gates run on node builtins
 * with no install (`quality:portability` is plain `node scripts/*.mjs`). The
 * shapes it must see are `import … from 'x'`, `export … from 'x'` and bare
 * `import 'x'`; the shape it must NOT see is a statement-level type import.
 */
function runtimeImports(source) {
  const specifiers = [];
  // The clause may span newlines (`import {\n a,\n b\n} from 'x'`) but may
  // never contain a quote or a semicolon: both would mean it had run past the
  // end of its own statement and swallowed the next one. Without that, a bare
  // `import 'x';` on the line above lets the clause absorb the `type` keyword
  // of the statement below it, and a type-only import is read as an edge.
  const re = /(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)from\s*['"]([^'"]+)['"]/g;
  for (const [, clause, specifier] of source.matchAll(re)) {
    if (/^\s*type\s/.test(clause)) continue;
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier);
  }
  return specifiers;
}

/** Resolve a relative specifier the way the TS `exports` map does. */
function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate)) return candidate;
      } catch {
        // A directory, not a module — keep looking.
      }
    }
  }
  return null;
}

const show = (file) => relative(REPO_ROOT, file);

/**
 * Breadth-first, so the chain reported is the SHORTEST one — the edge whose
 * removal is most likely to be the fix, rather than whichever path a
 * depth-first walk happened to descend first.
 */
export function firstBuiltinReach(entry = ROOT_ENTRY) {
  const seen = new Set([entry]);
  const queue = [[entry]];
  while (queue.length > 0) {
    const chain = queue.shift();
    const file = chain[chain.length - 1];
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // eslint-disable-next-line no-restricted-syntax -- A BFS over a module graph: the `seen` set enqueues each file at most once, so the total work is O(vertices + edges) in a tree of ~200 modules, not quadratic.
    for (const specifier of runtimeImports(source)) {
      if (isNodeBuiltin(specifier)) return { chain, specifier };
      if (!specifier.startsWith('.')) continue;
      const next = resolveRelative(file, specifier);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return null;
}

export { runtimeImports };

const reach = process.env.ROOT_ENTRY_GATE_SELFTEST ? null : firstBuiltinReach();

if (reach) {
  console.error(
    `root-entry-browser-safe: the root entry reaches '${reach.specifier}', which no browser bundle can resolve.`,
  );
  console.error('\nThe path:');
  reach.chain.forEach((file, index) => {
    console.error(`  ${'  '.repeat(index)}${index === 0 ? '' : '→ '}${show(file)}`);
  });
  console.error(
    `  ${'  '.repeat(reach.chain.length)}→ ${reach.specifier}   ← externalized in a browser build`,
  );
  console.error(
    '\n@12-apps/payments-frontend value-imports this entry from its stories, so this\n' +
      'breaks the Storybook build. Cut the FIRST edge above that carries server-only\n' +
      'code and ship that capability at its own subpath instead — no browser build\n' +
      'reaches a subpath. See the rule in src/index.ts.',
  );
  process.exit(1);
}

if (!process.env.ROOT_ENTRY_GATE_SELFTEST) {
  console.log('root-entry-browser-safe: clean — the root entry reaches no Node builtin.');
}
