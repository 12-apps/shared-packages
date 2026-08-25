// Self-test for `side-effects-gate.mjs`.
//
// A gate over a SILENT property has to be tested against synthetic breakage,
// because the tree it guards is (by construction) always passing. The direction
// that matters most is the one that fails quietly: a detector that stopped
// recognising a top-level call would report every package clean, invite a
// blanket `"sideEffects": false`, and license bundlers to delete a registry
// nobody would miss until runtime, in a consumer, far from here.
//
// So this asserts the classifier's verdict on real code shapes rather than the
// gate's exit code on the repo.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sideEffectReason, matchesGlob, auditPackage } from './side-effects-gate.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'side-effects-'));
const at = (name, source) => {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
};

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

console.log('detects a real import-time effect');

check('a top-level call', () => {
  const reason = sideEffectReason(at('call.ts', "import x from 'x';\nx.config();\n"));
  assert.ok(reason, 'a top-level call must be reported');
  assert.match(reason.why, /top-level call/);
});

check('a bare side-effect import', () => {
  assert.match(sideEffectReason(at('bare.ts', "import './polyfill';\n")).why, /bare import/);
});

check('a top-level await', () => {
  assert.match(sideEffectReason(at('await.ts', 'export const a = 1;\nawait Promise.resolve();\n')).why, /await/);
});

check('a write to an IMPORTED binding', () => {
  const reason = sideEffectReason(at('global.ts', "import { registry } from './r';\nregistry.enabled = true;\n"));
  assert.ok(reason, 'writing through an imported binding escapes the module');
});

check('a registry registration (the @12-apps/ui shape)', () => {
  const source = [
    "import { register } from './registry';",
    'const bar = () => ({});',
    "register('bar', bar);",
    '',
  ].join('\n');
  assert.ok(sideEffectReason(at('registry.ts', source)), 'registration must be reported');
});

console.log('ignores writes onto the module\'s own bindings');

check('displayName', () => {
  const source = 'export const Card = () => null;\nCard.displayName = "Card";\n';
  assert.equal(sideEffectReason(at('display.tsx', source)), null);
});

check('a compound component (Dashboard.Header = …)', () => {
  const source = [
    'const Header = () => null;',
    'export const Dashboard = () => null;',
    'Dashboard.Header = Header;',
    '',
  ].join('\n');
  assert.equal(sideEffectReason(at('compound.tsx', source)), null);
});

check('a slot marker written through a cast', () => {
  const source = [
    'type Slotted = { slot?: string };',
    'export const Body = () => null;',
    "(Body as Slotted).slot = 'body';",
    '',
  ].join('\n');
  assert.equal(sideEffectReason(at('slot.tsx', source)), null,
    'a cast must not hide that the target is local');
});

check("a 'use client' directive", () => {
  assert.equal(sideEffectReason(at('directive.tsx', "'use client';\nexport const A = () => null;\n")), null);
});

console.log('matches globs the way a bundler does');

check('** spans directories', () => {
  assert.ok(matchesGlob('**/e2e/**', 'src/e2e/steps/a.steps.ts'));
  assert.ok(!matchesGlob('**/e2e/**', 'src/server/a.ts'));
});

check('* stops at a path segment', () => {
  assert.ok(matchesGlob('**/factory.*', 'src/db/lib/factory.ts'));
  assert.ok(!matchesGlob('src/*.ts', 'src/db/lib/factory.ts'));
});

check('a path-anchored entry only matches that path', () => {
  assert.ok(matchesGlob('**/db/lib/factory.*', 'src/db/lib/factory.ts'));
  assert.ok(!matchesGlob('**/db/lib/factory.*', 'src/other/factory.ts'));
});

console.log('fails a package in BOTH directions');

function fixture(name, manifest, files) {
  const root = path.join(dir, name);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, ...manifest }));
  for (const [rel, source] of Object.entries(files)) at(path.join(name, rel), source);
  return root;
}

check('an uncovered effect is refused', () => {
  const root = fixture('pkg-uncovered', { sideEffects: false }, {
    'src/boot.ts': "import x from 'x';\nx.config();\n",
  });
  const { problems } = auditPackage(root);
  assert.equal(problems.length, 1, 'exactly the uncovered file');
  assert.match(problems[0], /src\/boot\.ts:2/);
  assert.match(problems[0], /licensed to drop it/);
});

check('a stale allowlist entry is refused', () => {
  const root = fixture('pkg-stale', { sideEffects: ['**/gone.*'] }, {
    'src/pure.ts': 'export const a = 1;\n',
  });
  const { problems } = auditPackage(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /stale allowlist|no shipped file under it/);
});

check('no declaration at all is refused', () => {
  const root = fixture('pkg-undeclared', {}, { 'src/pure.ts': 'export const a = 1;\n' });
  const { problems } = auditPackage(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /declares no `sideEffects`/);
});

check('a correct allowlist passes', () => {
  const root = fixture('pkg-ok', { sideEffects: ['**/boot.*'] }, {
    'src/boot.ts': "import x from 'x';\nx.config();\n",
    'src/pure.ts': 'export const a = 1;\n',
  });
  assert.deepEqual(auditPackage(root).problems, []);
});

check('a test file is not shipped, so cannot make a package dirty', () => {
  const root = fixture('pkg-tests', { sideEffects: false }, {
    'src/__tests__/a.test.ts': "import x from 'x';\nx.config();\n",
    'src/pure.ts': 'export const a = 1;\n',
  });
  assert.deepEqual(auditPackage(root).problems, []);
});

rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`\nside-effects selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nside-effects selftest: all checks passed');
