/**
 * Every entry ships COMPILED, the marketplace precedent: a host mounts this in
 * a Node process, and Node refuses to strip types below `node_modules`.
 * `splitting: true` keeps the engine's modules one copy across entries.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "engine/index": "src/engine/index.ts",
    "manifest/index": "src/manifest/index.ts",
    "sale/index": "src/sale/index.ts",
    "sidecar/index": "src/sidecar/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  keepNames: true,
  sourcemap: true,
  clean: false,
});
