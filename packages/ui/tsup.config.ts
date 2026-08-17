/**
 * EVERY consumer entry is compiled, and that is a correction (12-51).
 *
 * This package declared 129 subpath exports and every one of them resolved to
 * raw TypeScript under `./src`. Node refuses to strip types below
 * `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so any
 * consumer reaching this package outside a bundler simply could not load it.
 * The build that existed here compiled `src/index.ts` alone, so 128 of those
 * exports had never had a compiled target at all.
 *
 * It hid for the reasons `@12-apps/app-shell`'s own config already documents, and
 * this is the same defect one layer down: pnpm links a workspace sibling, whose
 * realpath falls outside `node_modules` where stripping is allowed; and anything
 * behind a bundler compiles the source anyway — Vite for an SPA build, Vitest
 * for a spec. Only a real Node resolution path sees it. app-shell 4.0.0 is what
 * finally produced one: once it shipped compiled output, Vitest correctly
 * externalised it to Node, Node took ownership of everything below it, and its
 * bare `@12-apps/ui/**` imports hit raw `.ts`. That took out all three SPA suites
 * in the first adopter at once.
 *
 * ## `splitting: true` is load-bearing, not a size optimisation
 *
 * With 129 entries and splitting off, every entry inlines its own private copy
 * of whatever it pulls from `src/` — the theme, the emotion cache, the React
 * contexts. Two copies of a context object are two providers: a consumer that
 * imports a component from one subpath and its provider from another reads a
 * different context instance and silently gets the default. That is app-shell's
 * `instanceof ApiError` lesson with a worse blast radius, because nothing
 * throws — the component just renders unthemed.
 *
 * With splitting, rollup emits each shared module once and every entry imports
 * the same chunk, so the guarantee is structural rather than a convention
 * someone has to remember.
 *
 * ## ESM only
 *
 * The previous config emitted cjs as well. Nothing consumed it: the exports map
 * pointed at `./src`, so `dist` was unreachable through every subpath, and
 * dropping a format no resolution path could reach breaks nothing. It is also
 * not a free choice — esbuild's code splitting is ESM-only, so a cjs build would
 * reintroduce exactly the duplicate-module problem above for anyone using it.
 *
 * ## The entry list
 *
 * `entries.json` is the single source of truth, mapping each public subpath to
 * its source file. This config builds from it and `scripts/sync-exports.mjs`
 * generates `package.json#exports` from it, so a 129-entry surface cannot drift
 * against its own build. `pnpm exports:check` fails if it has.
 *
 * ## Declarations come from `tsc`, not from tsup
 *
 * `dts: true` does not survive this entry count. tsup builds declarations by
 * rolling each entry's type graph up separately, so 129 entries over a MUI
 * surface means 129 near-complete copies of it in one worker: the JS build
 * finishes in under half a second and the dts worker then dies with
 * `ERR_WORKER_OUT_OF_MEMORY`. Raising the heap would buy a slower build that
 * fails again at entry 150.
 *
 * `tsc --emitDeclarationOnly` is the right tool at this scale — it walks the
 * program once and mirrors `src/` into `dist/types/`. The layouts differ, which
 * costs nothing: an exports entry names `types` and `default` separately, so
 * `./button` is `dist/types/button/index.d.ts` alongside `dist/button.js`.
 * `build` therefore runs tsup first (it owns `clean`) and tsc second.
 *
 * ## What this does NOT fix, measured
 *
 * Compiling removes OUR half of the problem and cannot remove MUI's. Under real
 * Node ESM resolution `@mui/material` loads only at its ROOT: every deep path
 * refuses, `@mui/material/styles` and `@mui/material/Box` and even
 * `@mui/material/Box/index.js`, because MUI 6 has no `exports` map and its
 * internals deep-import each other the same way (`Box/boxClasses.js` pulls
 * `@mui/utils/generateUtilityClasses`, another directory). Icons refuse too.
 *
 * So 29 of 129 entries load under bare Node after this change — the 100 that do
 * not are blocked inside MUI, not here, and no amount of work in this package
 * moves them. An earlier revision of this config tried rewriting those
 * specifiers to `/index.js`; it was removed because it only relocated the same
 * error one directory deeper. The remaining step, if full Node loadability is
 * ever wanted, is importing from the `@mui/material` ROOT barrel instead of deep
 * paths — a source change across 121 specifiers with its own tree-shaking
 * trade-off, tracked separately on 12-51 rather than smuggled in here.
 *
 * None of this affects a bundler, which is what every consumer uses today.
 *
 * `COMPONENT=<name>` still builds one component in isolation for a quick local
 * loop; it writes to `dist/<name>`, skips declarations, and is not what
 * publishing uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { glob } from 'glob';
import { defineConfig, type Options } from 'tsup';

const shared = {
  format: ['esm'] as const,
  // See the docstring: `tsc --emitDeclarationOnly` emits these, via `build:types`.
  dts: false,
  sourcemap: true,
  clean: true,
  // The consumer's. A bundled copy of react is a second renderer, and of
  // @mui / @emotion a second design system with its own cache.
  //
  external: [
    'react',
    'react-dom',
    '@mui/material',
    '@mui/icons-material',
    '@emotion/react',
    '@emotion/styled',
  ],
};

export default defineConfig(() => {
  const component = process.env.COMPONENT;

  if (component) {
    const entry = glob.sync(`src/components/**/${component}/index.{ts,tsx}`);
    if (entry.length === 0) {
      console.error(`Component "${component}" not found!`);
      process.exit(1);
    }
    return { ...shared, entry, splitting: false, outDir: `dist/${component}` };
  }

  return {
    ...shared,
    // Resolved against THIS FILE, never the cwd. knip loads this config to
    // discover entry points and runs it from the repo root, where a relative
    // 'entries.json' is ENOENT — which fails the whole static-gates job, not
    // just knip. `__dirname` because tsup transpiles this config to CJS, so
    // `import.meta` is not available here (see the plugin note below).
    entry: JSON.parse(readFileSync(join(__dirname, 'entries.json'), 'utf8')) as Record<
      string,
      string
    >,
    // See the docstring: this is what keeps the theme, the emotion cache and
    // every React context a single module across 129 entries.
    splitting: true,
    outDir: 'dist',
  };
});
