import { defineConfig } from 'vitest/config';

// No aliases. The packages under test must resolve as a consumer's would —
// out of node_modules, from the tarball — or the harness is testing the
// workspace it exists to look past.
// `hookTimeout` matches `testTimeout` because the hooks here do the same class of
// work the tests do: almost every suite's `beforeAll` calls `createHarnessBackend`,
// which applies TWELVE packages' migrations into a fresh PGlite. Vitest's hook
// default is 10s regardless of `testTimeout`, and with 35 suites provisioning in
// parallel that budget is now the tightest thing in the run — observed as
// `tests/harness-server.test.ts` timing out in its `beforeAll` on one run and
// passing in 3.5s alone on the next. A flaky red here reads as a broken package,
// which is the one thing this harness must never say by accident.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // NOT an alias, and not a hole in the rule at the top of this file:
        // resolution still goes through `node_modules` and the package's own
        // `exports` map, exactly as a consumer's would. Only the TRANSFORM
        // changes hands — Vite compiles this dependency instead of handing it
        // to Node.
        //
        // It became necessary the moment `@12-apps/ui` started shipping compiled
        // entries. While it published `.ts`, Vite could not externalise it and
        // so compiled the whole chain underneath, MUI included. Now that it
        // ships `.js`, Vitest correctly externalises it and Node owns everything
        // below — and Node cannot resolve MUI, which ships no `exports` map and
        // whose internals deep-import each other:
        // `@mui/icons-material/esm/utils/createSvgIcon.js` reaches into
        // `@mui/material/utils`. No source change in this repository is on that
        // path.
        //
        // The only subpath here that reaches it is `@12-apps/storage/react`, a
        // BROWSER half whose real consumer is a bundler — which is precisely
        // what inlining models. Every backend entry stays externalised and goes
        // on being loaded the way a Node host loads it, which is the property
        // this harness exists to check.
        //
        // `@mui` is on the list for a reason worth stating, because inlining
        // `@12-apps/ui` alone does NOT work and looks like it should. The import
        // that fails is not ours: it is `@mui/icons-material`'s own
        // `createSvgIcon.js` reaching into `@mui/material/utils`. Inlining `ui`
        // hands Vite only `ui`'s code and leaves MUI external, so Node still
        // resolves that inner edge and still refuses it. MUI has to be
        // transformed too for Vite's resolver — which understands a directory
        // import — to be the one answering.
        inline: [/@12-apps\/ui/, /@mui\//],
      },
    },
  },
});
