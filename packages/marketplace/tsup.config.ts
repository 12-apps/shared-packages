/**
 * Every entry ships COMPILED: `./server`, `./hono` and the engine itself exist
 * to be mounted in a Node process, and Node refuses to strip types below
 * `node_modules` (the notifications precedent, which states the argument in
 * full). `splitting: true` keeps the engine's modules one copy across entries,
 * so a value built by `.` and read by `./server` is the same value.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ifood/index': 'src/ifood/index.ts',
    'ifood/pt-BR': 'src/ifood/pt-BR.ts',
    'ifood/en-US': 'src/ifood/en-US.ts',
    'server/index': 'src/server/index.ts',
    'server/pt-BR': 'src/server/pt-BR.ts',
    'server/en-US': 'src/server/en-US.ts',
    'hono/index': 'src/hono/index.ts',
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
