// The `sideEffects` gate: a package's tree-shaking claim must match its code.
//
// `"sideEffects": false` tells every bundler that importing a module from this
// package and using nothing from it is observationally identical to not
// importing it at all — so the module may be elided whole. That is the single
// most valuable thing a library can say about itself, and it is also a claim
// that fails SILENTLY in both directions.
//
// ## Why it is worth saying
//
// Without it a bundler must assume any module reachable from a barrel might do
// work at import time, so it keeps them. Measured in an adopting storefront,
// where a single always-mounted module imports exactly one predicate —
// `hostedCheckoutReturnPending` — from `@12-apps/payments-frontend`'s root: the
// eager chunk retained ~200 modules of this package, the whole PIX checkout
// view, `qrcode-generator` and `react-qr-code`. Declaring these flags took that
// chunk from 1,040 kB to 946 kB raw and 330 kB to 300 kB gzip on its own, with
// the code relocating into the lazy checkout chunk where it belonged.
//
// ## Why it needs a gate rather than a convention
//
// A WRONG `false` deletes work nobody asked to delete. The failure is not a
// build error — it is a registry that is empty at runtime, an env default never
// applied, a global dispatcher never installed. It surfaces in the consumer, at
// runtime, far from the package that lied. And it appears the day someone adds
// a top-level statement to a file in a package flagged long before, which is
// precisely when nobody is thinking about this line of its manifest.
//
// So the declaration is DERIVED here rather than trusted: every shipped source
// file is parsed, its top-level statements classified, and the result compared
// with what `package.json` says.
//
// ## What counts as a side effect
//
// A statement that runs at import time and can be observed from outside the
// module:
//
//   - a bare `import './x'`, whose only purpose IS the effect
//   - a top-level call        `dotenv.config()`, `setEnvDefaults(config)`,
//                             `registerChartSpecRenderer('bar', …)`, `Given(…)`
//   - a top-level await
//   - a write to an imported or global binding
//
// And what deliberately does NOT count: a property written onto a binding
// DECLARED IN THE SAME FILE. `Card.displayName = 'Card'`,
// `Dashboard.Header = DashboardHeader`, `(X as Slotted).dashboardSlot = 'body'`
// are ~1,400 statements across `@12-apps/ui` alone, and every one of them is
// moot if the module is elided — the object being written to is elided with it,
// so nothing can observe the difference. Counting them would pin every
// component module in the library and hand back the entire benefit.
//
// ## The two failure directions, both fatal
//
//   - a file HAS a top-level effect and the declaration does not cover it
//     -> fail. This is the dangerous one: the bundler is licensed to drop it.
//   - a package declares a path that no longer has any effect
//     -> fail as stale. An allowlist that outlives its reason is one nobody can
//        read, and it quietly re-pins a module for ever.
//
// A package with no declaration at all fails too. Tree-shakeability is part of
// the published contract here, so "did not get round to it" is not a state a
// new package may sit in.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Never shipped, so never a consumer's problem. */
const NOT_SHIPPED = /(__tests__|[.]test[.]|[.]spec[.]|[.]stories[.]|test-helpers|\/tests?\/|\.d\.ts$)/;

function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) {
      if (!['node_modules', 'dist', '.turbo', 'coverage'].includes(entry)) sourceFiles(file, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(file) && !NOT_SHIPPED.test(file)) out.push(file);
  }
  return out;
}

/** Top-level `const`/`function`/`class` names — the bindings this module owns. */
function localBindings(src) {
  const names = new Set();
  for (const st of src.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
      names.add(st.name.getText(src));
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.getText(src));
      }
    }
  }
  return names;
}

/** `(X as T).y.z` -> `X`, so a cast or a parenthesis cannot hide the target. */
function baseIdentifier(node, src) {
  let n = node;
  while (
    ts.isPropertyAccessExpression(n) || ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) || ts.isNonNullExpression(n)
  ) {
    n = n.expression;
  }
  return ts.isIdentifier(n) ? n.getText(src) : null;
}

/** The reason this file must survive elision, or `null` if it need not. */
export function sideEffectReason(file, text = readFileSync(file, 'utf8')) {
  const src = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const locals = localBindings(src);
  for (const st of src.statements) {
    const line = src.getLineAndCharacterOfPosition(st.getStart(src)).line + 1;
    if (ts.isImportDeclaration(st) && !st.importClause) return { line, why: 'bare import' };
    if (!ts.isExpressionStatement(st)) continue;
    const e = st.expression;
    if (
      ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(e.left) && locals.has(baseIdentifier(e.left, src))
    ) {
      continue; // a write onto this module's own binding — see the header
    }
    if (ts.isCallExpression(e)) {
      return { line, why: `top-level call: ${e.getText(src).split('\n')[0].slice(0, 60)}` };
    }
    if (ts.isAwaitExpression(e)) return { line, why: 'top-level await' };
    if (ts.isBinaryExpression(e)) return { line, why: 'top-level write to a non-local binding' };
  }
  return null;
}

/**
 * Match a `sideEffects` glob the way a bundler does — against the path relative
 * to the package root. `**` spans directories, `*` does not; that is the whole
 * syntax any declaration in this repo uses.
 */
export function matchesGlob(glob, relPath) {
  const pattern = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^(?:\\./)?${pattern}$`).test(relPath);
}

export function auditPackage(pkgDir) {
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const declared = manifest.sideEffects;
  const effectful = [];
  for (const file of sourceFiles(path.join(pkgDir, 'src'))) {
    const reason = sideEffectReason(file);
    if (reason) effectful.push({ rel: path.relative(pkgDir, file), ...reason });
  }
  const problems = [];

  if (declared === undefined) {
    problems.push(
      'declares no `sideEffects`. Every published package must state whether it is tree-shakeable. ' +
      (effectful.length
        ? `This one is not entirely — declare an allowlist covering its ${effectful.length} import-time statement(s).`
        : 'This one is: add "sideEffects": false.'),
    );
  }

  const globs = declared === false ? [] : Array.isArray(declared) ? declared : null;
  if (globs) {
    for (const hit of effectful) {
      if (!globs.some((g) => matchesGlob(g, hit.rel))) {
        problems.push(
          `${hit.rel}:${hit.line} runs at import time (${hit.why}) but no \`sideEffects\` entry covers it, ` +
          'so a bundler is licensed to drop it. Add a glob for this file, or move the statement into a function.',
        );
      }
    }
    for (const g of globs) {
      if (!effectful.some((hit) => matchesGlob(g, hit.rel))) {
        problems.push(
          `\`sideEffects\` lists "${g}", but no shipped file under it runs anything at import time. ` +
          'Remove the entry — a stale allowlist re-pins a module for ever.',
        );
      }
    }
  }
  return { name: manifest.name, effectful, problems };
}

/** The publishable set, read from the one file that already owns it. */
export function publishableDirs() {
  return readFileSync(path.join(ROOT, 'release-packages.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function main() {
  const dirs = publishableDirs();
  let failed = 0;
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(path.join(abs, 'package.json'))) continue;
    const { name, problems } = auditPackage(abs);
    if (!problems.length) continue;
    failed += 1;
    console.error(`\n${name} (${dir})`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
  if (failed) {
    console.error(`\n${failed} package(s) whose \`sideEffects\` does not match their code.`);
    process.exit(1);
  }
  console.log(`side-effects: ${dirs.length} packages verified`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
