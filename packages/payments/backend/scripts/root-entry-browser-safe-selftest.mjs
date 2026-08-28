// Self-tests for the root-entry gate. Node builtins only, no install.
//
// This is the half that matters, and the reason is the shape of the gate's
// failure modes: they are all GREEN. A walk that stops recognizing an import
// reports "the root entry reaches no Node builtin" over a tree where it does,
// and the next Storybook build is the only thing that disagrees — which is
// exactly the seven-minute, several-files-away diagnosis the gate exists to
// replace. Nothing is red at any point, so the sweep can only be trusted while
// something proves it still sees.
//
// The cases below are the four ways it could go quietly blind: a transitive
// reach (the real bug), a bare builtin, a type-only edge it must NOT follow,
// and a value edge that merely LOOKS type-only.
process.env.ROOT_ENTRY_GATE_SELFTEST = '1';

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { firstBuiltinReach, runtimeImports } = await import('./root-entry-browser-safe-gate.mjs');

/** Write a throwaway module tree and return the path of its entry. */
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'root-entry-gate-'));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source);
  }
  return join(dir, 'index.ts');
}

// 1. The real bug, three hops deep: nothing on the path names crypto except the
//    leaf, and the file somebody edited is the first hop.
{
  const entry = tree({
    'index.ts': `export * from './public';`,
    'public.ts': `export { resolver } from './resolve';`,
    'resolve.ts': `import { sha } from './shared';\nexport const resolver = sha;`,
    'shared.ts': `import { createHash } from 'node:crypto';\nexport const sha = createHash;`,
  });
  const reach = firstBuiltinReach(entry);
  assert.ok(reach, 'a transitive reach into node:crypto must be caught');
  assert.equal(reach.specifier, 'node:crypto');
  assert.equal(reach.chain.length, 4, 'the whole path must be reported, not just the leaf');
}

// 2. A bare builtin. The repo writes `node:`-prefixed specifiers, so an
//    unprefixed one is the shape that would slip past a `startsWith` test.
{
  const entry = tree({ 'index.ts': `import { createHash } from 'crypto';\nexport const x = createHash;` });
  assert.ok(firstBuiltinReach(entry), 'a bare builtin must be caught too');
}

// 3. A type-only edge is NOT an edge — it is erased before any bundle exists,
//    so following it would fail a tree the bundler is perfectly happy with.
//    The root barrel is mostly this shape, so a gate that got it wrong would be
//    red on every commit and would simply be deleted.
{
  const entry = tree({
    'index.ts': `import type { T } from './server';\nexport type { T };`,
    'server.ts': `import { createHash } from 'node:crypto';\nexport type T = typeof createHash;`,
  });
  assert.equal(firstBuiltinReach(entry), null, 'a type-only import must not be followed');
}

// 4. …but an INLINE type modifier in an otherwise-value statement is a real
//    import, and the naive "does the clause mention `type`" test gets it wrong
//    in the unsafe direction.
{
  const entry = tree({
    'index.ts': `export { value, type T } from './server';`,
    'server.ts': `import { createHash } from 'node:crypto';\nexport const value = createHash;\nexport type T = string;`,
  });
  assert.ok(firstBuiltinReach(entry), 'a value export with an inline type modifier is still an edge');
}

// 5. The parser itself, on the three statement shapes it has to see.
{
  const specifiers = runtimeImports(
    [
      `import a from 'one';`,
      `import { b } from "two";`,
      `export { c } from 'three';`,
      `export * from 'four';`,
      `import 'five';`,
      `import type { D } from 'six';`,
      `export type { E } from 'seven';`,
    ].join('\n'),
  );
  assert.deepEqual(
    specifiers.sort(),
    ['five', 'four', 'one', 'three', 'two'],
    'value statements are edges; statement-level type ones are not',
  );
}

console.log('root-entry-browser-safe-selftest: 5 cases passed.');
