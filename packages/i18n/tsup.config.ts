/**
 * Ships COMPILED, for the reason `@12-apps/forms-core` and `@12-apps/app-shell`
 * both record: Node refuses to strip types below `node_modules`, so a package
 * exporting `src/index.ts` is unimportable from any real Node process
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — and invisible until
 * PUBLISH, because pnpm links a workspace sibling outside `node_modules` where
 * stripping is allowed. Both halves of this package's audience are exposed:
 * `./server` is mounted in an API process and `.` is read by both.
 *
 * `splitting: true` for the reason app-shell states: `LocaleContext` is a
 * module-level identity, and `./react` reading one context while a consumer's
 * provider wrote another is a hook that throws "must be called inside
 * <LocaleProvider>" from inside a LocaleProvider. Splitting emits `core/*` and
 * the context module once and every entry imports the same chunk.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    'server/index': 'src/server/index.ts',
    'manifest/index': 'src/manifest/index.ts',
    'manifest/server': 'src/manifest/server.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,
  keepNames: true,
  sourcemap: true,
  // The build script removes `dist` before tsup starts, matching the other
  // packages here — an entry owning `clean` races its siblings.
  clean: false,
});
