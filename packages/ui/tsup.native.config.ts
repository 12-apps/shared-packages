/**
 * THE NATIVE BUILD: `entries.native.json` into `dist/native/`.
 *
 * A second tsup pass rather than more entries in the first, because the two
 * halves have opposite externals. The web build leaves `@mui/*` and `@emotion/*`
 * to the consumer and would choke on `react-native`; this one leaves `react`,
 * `react-native` and `react-native-svg` to the consumer's Metro and must never
 * see MUI at all — a native file that imports it is a bug, and the plugin below
 * turns that bug into a build error with the importer's path, instead of a
 * bundle that grows by all of emotion and fails at runtime on `document`.
 *
 * Native sources name their `.native` siblings explicitly (`./Button.native`),
 * so this pass needs no `resolveExtensions` trick and its output is honest
 * about what it contains. Shared modules — the tokens, a component's
 * `*.metrics.ts`, the platform helpers — are plain TypeScript both passes
 * compile; `splitting: true` keeps each one a single chunk per build, for the
 * same reason `tsup.config.ts` gives.
 *
 * `platform: 'neutral'` because the target is neither node nor a browser: Metro
 * does its own platform resolution downstream and wants plain ESM.
 *
 * Declarations come from `tsc -p tsconfig.native.json`, mirroring `src/` into
 * `dist/types-native/`, for the reason the web config documents.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig, type Options } from 'tsup';

const WEB_ONLY = /^(@mui\/|@emotion\/|react-dom$|react-dom\/)/;

/** Fails the build on a web-only import reached from the native entry graph. */
const forbidWebOnly: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'ui-native-forbid-web-only',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!WEB_ONLY.test(args.path)) return null;
      return {
        errors: [
          {
            text: `@12-apps/ui native build: "${args.path}" is web-only. Native files import react-native primitives and the shared tokens, never MUI, emotion or react-dom.`,
            detail: { importer: args.importer },
          },
        ],
      };
    });
  },
};

export default defineConfig(() => {
  const entries: Record<string, string> = JSON.parse(
    readFileSync(join(__dirname, 'entries.native.json'), 'utf8'),
  );

  return {
    entry: entries,
    format: ['esm'],
    platform: 'neutral',
    target: 'es2020',
    dts: false,
    sourcemap: true,
    // `tsup.config.ts` owns `clean`; this pass writes into a subdirectory of
    // the same `dist` and must not wipe the web build beside it.
    clean: false,
    splitting: true,
    outDir: 'dist/native',
    external: ['react', 'react/jsx-runtime', 'react-native', 'react-native-svg'],
    esbuildPlugins: [forbidWebOnly],
    esbuildOptions(options) {
      // Metro understands `.js`, and a chunk name that says where it came from
      // is worth more than a hash when a stack trace names it.
      options.chunkNames = 'chunks/[name]-[hash]';
    },
  };
});
