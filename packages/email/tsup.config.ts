/**
 * Ships COMPILED, for the reason `@12-apps/i18n` and `@12-apps/forms-core` both
 * record: Node refuses to strip types below `node_modules`, so a package
 * exporting `src/index.ts` is unimportable from any real Node process
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — and invisible until
 * PUBLISH, because pnpm links a workspace sibling outside `node_modules` where
 * stripping is allowed. Both halves here are exposed: `./server` is mounted in
 * an API process, and `.` is rendered from jobs and webhooks with no browser in
 * the room.
 *
 * `splitting: true` so the document model and the renderer are emitted ONCE and
 * every entry imports the same chunk. It matters more here than most: `.`,
 * `./server` and `./react` all reach the same `renderEmail`, and a second copy
 * would be a second layout — the exact thing this package exists to end.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    locales: 'src/locales.ts',
    'server/index': 'src/server/index.ts',
    'hono/index': 'src/hono/index.ts',
    'react/index': 'src/react/index.tsx',
    'manifest/index': 'src/manifest/index.ts',
    'manifest/server': 'src/manifest/server.ts',
    'manifest/web': 'src/manifest/web.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,
  keepNames: true,
  sourcemap: true,
  // The build script removes `dist` before tsup starts, matching every other
  // package here — an entry owning `clean` races its siblings.
  clean: false,
});
