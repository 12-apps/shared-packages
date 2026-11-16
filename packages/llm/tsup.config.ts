/**
 * The entry ships COMPILED: a host calls this from a Node process, and Node
 * refuses to strip types below `node_modules`. The provider SDKs are optional
 * peers, imported dynamically by their adapter, so they stay external.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  splitting: false,
  keepNames: true,
  sourcemap: true,
  clean: false,
  external: ["@anthropic-ai/sdk", "openai", "@google/genai"],
});
