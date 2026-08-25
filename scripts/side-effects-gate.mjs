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
//
// ## The globs describe SOURCE, and most of these packages ship a bundled dist
//
// This audits `src/**`, so an allowlist entry names a source file. Several
// packages resolve their exports to a BUNDLED `dist` instead, where tsup has
// already merged many source modules into one emitted chunk — so a glob like
// `**/chart-spec-registry.*` matches nothing a consumer's bundler will ever
// see, and for that build the package behaves as fully side-effect-free.
//
// That is sound rather than a hole, and it is worth knowing why. Bundling only
// ever MERGES modules, and the effect and its observer merge together:
// `@12-apps/ui`'s renderer registrations, the Map they write to and the getter
// that reads it all land in one emitted chunk. Elision works on whole modules,
// so it can only drop all three at once — which is the correct outcome, since
// nothing imported them. The entry stays because it is the truthful statement
// about the source this repo maintains, and because a chunk's emitted name is
// content-derived and could not be listed here anyway.
//
// What WOULD break the reasoning is a package whose import-time effect is
// observed from a DIFFERENT emitted chunk. None here is: every allowlisted file
// either mutates a binding its own chunk owns, or is an e2e entry a bundler
// never reaches.
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

/** The names a top-level statement introduces into this module's scope. */
function declaredBy(statement, src) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
    return [statement.name.getText(src)];
  }
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations
    .filter((d) => ts.isIdentifier(d.name))
    .map((d) => d.name.getText(src));
}

/** Top-level `const`/`function`/`class` names — the bindings this module owns. */
function localBindings(src) {
  return new Set(src.statements.flatMap((statement) => declaredBy(statement, src)));
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

/** A write onto a binding this module declares — invisible if the module goes. */
function writesOnlyToOwnBinding(expression, src, locals) {
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    locals.has(baseIdentifier(expression.left, src))
  );
}

/** Why this ONE statement would have to survive elision, or `null`. */
function statementEffect(statement, src, locals) {
  if (ts.isImportDeclaration(statement)) {
    return statement.importClause ? null : 'bare import';
  }
  if (!ts.isExpressionStatement(statement)) return null;
  const expression = statement.expression;
  if (writesOnlyToOwnBinding(expression, src, locals)) return null;
  if (ts.isCallExpression(expression)) {
    return `top-level call: ${expression.getText(src).split('\n')[0].slice(0, 60)}`;
  }
  if (ts.isAwaitExpression(expression)) return 'top-level await';
  if (ts.isBinaryExpression(expression)) return 'top-level write to a non-local binding';
  return null;
}

/** The reason this file must survive elision, or `null` if it need not. */
export function sideEffectReason(file, text = readFileSync(file, 'utf8')) {
  const src = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const locals = localBindings(src);
  for (const statement of src.statements) {
    const why = statementEffect(statement, src, locals);
    if (why !== null) {
      return { line: src.getLineAndCharacterOfPosition(statement.getStart(src)).line + 1, why };
    }
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

/** Every shipped file that runs something at import time, with its reason. */
function importTimeStatements(pkgDir) {
  return sourceFiles(path.join(pkgDir, 'src'))
    .map((file) => ({ file, reason: sideEffectReason(file) }))
    .filter(({ reason }) => reason !== null)
    .map(({ file, reason }) => ({ rel: path.relative(pkgDir, file), ...reason }));
}

/** The dangerous direction: a bundler is licensed to drop this. */
function uncoveredProblems(effectful, globs) {
  return effectful
    .filter((hit) => !globs.some((glob) => matchesGlob(glob, hit.rel)))
    .map(
      (hit) =>
        `${hit.rel}:${hit.line} runs at import time (${hit.why}) but no \`sideEffects\` entry covers it, ` +
        'so a bundler is licensed to drop it. Add a glob for this file, or move the statement into a function.',
    );
}

/** The quiet direction: an allowlist that has outlived its reason. */
function staleProblems(effectful, globs) {
  return globs
    .filter((glob) => !effectful.some((hit) => matchesGlob(glob, hit.rel)))
    .map(
      (glob) =>
        `\`sideEffects\` lists "${glob}", but no shipped file under it runs anything at import time. ` +
        'Remove the entry — a stale allowlist re-pins a module for ever.',
    );
}

function undeclaredProblem(effectful) {
  return (
    'declares no `sideEffects`. Every published package must state whether it is tree-shakeable. ' +
    (effectful.length
      ? `This one is not entirely — declare an allowlist covering its ${effectful.length} import-time statement(s).`
      : 'This one is: add "sideEffects": false.')
  );
}

export function auditPackage(pkgDir) {
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const declared = manifest.sideEffects;
  const effectful = importTimeStatements(pkgDir);

  if (declared === undefined) {
    return { name: manifest.name, effectful, problems: [undeclaredProblem(effectful)] };
  }
  const globs = declared === false ? [] : Array.isArray(declared) ? declared : null;
  const problems = globs === null
    ? []
    : [...uncoveredProblems(effectful, globs), ...staleProblems(effectful, globs)];
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
    console.error(`\n${name} (${dir})\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  }
  if (failed) {
    console.error(`\n${failed} package(s) whose \`sideEffects\` does not match their code.`);
    process.exit(1);
  }
  console.log(`side-effects: ${dirs.length} packages verified`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
