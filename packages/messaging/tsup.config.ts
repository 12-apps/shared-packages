/**
 * Every entry ships COMPILED: the engine, the channel adapters and `./server`
 * exist to be mounted in a Node process, and Node refuses to strip types below
 * `node_modules`. `splitting: true` keeps the engine's modules one copy across
 * entries, so an error class thrown by `.` is the one `./server` checks.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'whatsapp/index': 'src/whatsapp/index.ts',
    'server/index': 'src/server/index.ts',
    'manifest/index': 'src/manifest/index.ts',
    'manifest/server': 'src/manifest/server.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,
  keepNames: true,
  sourcemap: true,
  clean: false,
});
