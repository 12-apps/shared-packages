// `package.json#exports` is GENERATED from `entries.json`. This writes it.
//
// This package has 129 public subpaths. Before 12-51 every one of them pointed
// at raw TypeScript under `./src`, which no Node consumer could load, and the
// build compiled `src/index.ts` alone — so 128 of them had no compiled target
// and nothing in the repo could tell, because a hand-maintained exports map and
// a hand-maintained entry list have no reason to agree.
//
// So they are no longer two lists. `entries.json` maps subpath -> source file
// and is the only thing anyone edits; `tsup.config.ts` builds from it and this
// script derives the exports map from it. A new component is one line there.
//
// The two output paths differ on purpose, and it costs nothing because an
// exports entry names them separately:
//
//   entries.json   "button": "src/button/index.ts"
//   ->  default    ./dist/button.js                  (tsup, flat, from the key)
//   ->  types      ./dist/types/button/index.d.ts    (tsc, mirrors src/)
//
// tsup is entry-keyed and `tsc --emitDeclarationOnly` mirrors the source tree;
// see `tsup.config.ts` for why declarations are tsc's job here at all.
//
// Usage:
//   node scripts/sync-exports.mjs           # write package.json#exports
//   node scripts/sync-exports.mjs --check   # fail if it has drifted (CI)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const check = process.argv.includes('--check');
const entries = JSON.parse(readFileSync('entries.json', 'utf8'));
const nativeEntries = JSON.parse(readFileSync('entries.native.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** `src/button/index.ts` -> `./dist/types/button/index.d.ts` */
const typesFor = (src) => `./dist/types/${src.replace(/^src\//, '').replace(/\.tsx?$/, '')}.d.ts`;
/** entry key `button` -> `./dist/button.js`, and `index` -> `./dist/index.js` */
const importFor = (name) => `./dist/${name}.js`;
/** `src/form/Button/index.native.ts` -> `./dist/types-native/form/Button/index.native.d.ts` */
const nativeTypesFor = (src) => `./dist/types-native/${src.replace(/^src\//, '').replace(/\.tsx?$/, '')}.d.ts`;
/** entry key `form/Button` -> `./dist/native/form/Button.js` */
const nativeImportFor = (name) => `./dist/native/${name}.js`;

// THE SWITCH. A subpath listed in `entries.native.json` gets a `react-native`
// condition ahead of `default`: Metro (React Native 0.79+ resolves package
// exports with `react-native` in its condition list) takes the native build,
// and every web bundler — which never asserts that condition — keeps the MUI
// one. The app names the platform nowhere; the same import resolves to the
// renderer the bundler is building for. A subpath NOT listed has no condition,
// so under Metro it resolves to the web build and fails at import on
// `@mui/material`, loudly, rather than rendering a blank view.
//
// Order is load-bearing: conditions are matched in object order, so
// `react-native` must precede `default`, and each condition names its own
// `types` because the two builds emit different declarations.
const expected = {};
for (const [name, src] of Object.entries(entries)) {
  const subpath = name === 'index' ? '.' : `./${name}`;
  const nativeSrc = nativeEntries[name];
  expected[subpath] = nativeSrc
    ? {
        'react-native': { types: nativeTypesFor(nativeSrc), default: nativeImportFor(name) },
        types: typesFor(src),
        default: importFor(name),
      }
    : { types: typesFor(src), default: importFor(name) };
}
for (const name of Object.keys(nativeEntries)) {
  if (!(name in entries)) {
    console.error(`ui exports: "${name}" is in entries.native.json but not in entries.json — a native build needs a web subpath to attach to.`);
    process.exit(1);
  }
}
// Deliberately NO `./package.json` export. It is a common convenience, and
// adding it here is a surface change this fix does not need: two suites assert
// that every export is a subpath a bundler can PRE-BUNDLE, and a manifest is
// not one. Compiling the entries is the change; widening the public surface
// alongside it would be a second, unrelated one.

if (check) {
  const actual = JSON.stringify(pkg.exports);
  if (actual !== JSON.stringify(expected)) {
    console.error(
      'ui exports: DRIFT — package.json#exports does not match entries.json.\n' +
        'Run "pnpm exports:sync" and commit the result.',
    );
    process.exit(1);
  }

  // A matching map still proves nothing if the build never emitted the files:
  // that is precisely how 128 exports pointed at source for as long as they did.
  // Every leaf, including the ones nested under a `react-native` condition:
  // the native build has its own `dist/native` and `dist/types-native` to be
  // missing from.
  const leaves = (target) =>
    typeof target === 'string' ? [target] : Object.values(target).flatMap(leaves);
  const missing = Object.entries(expected)
    .flatMap(([subpath, target]) => leaves(target).map((file) => `${subpath} -> ${file}`))
    .filter((entry) => !existsSync(entry.split(' -> ')[1]));
  if (missing.length > 0) {
    console.error(`ui exports: ${missing.length} target(s) missing from dist. Run "pnpm build".\n`);
    for (const line of missing.slice(0, 20)) console.error(`  ${line}`);
    if (missing.length > 20) console.error(`  … and ${missing.length - 20} more`);
    process.exit(1);
  }
  console.log(`ui exports: clean — ${Object.keys(entries).length} entries, every target built.`);
} else {
  pkg.exports = expected;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`ui exports: wrote ${Object.keys(entries).length} entries to package.json.`);
}
