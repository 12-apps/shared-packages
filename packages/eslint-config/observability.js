/**
 * The observability lint: `console.*` is refused in shipped source.
 *
 * The server half of the telemetry seam hangs off namespaced feature
 * loggers, and a `console.error` is invisible to it BY DESIGN — so in a
 * package that declares an observability namespace (mandatory for runtime
 * packages since wiring 1.3.0), a console call is a message routed to
 * nowhere. The binder hands every adopted package a logger already scoped
 * to its namespace; this rule is what makes reaching for it the ONLY path
 * an agent can take, instead of the one it must remember.
 *
 * Scope it to `src/`, not tests or scripts: a test may print, a CLI gate's
 * terminal output IS its interface, and a host's logger-port IMPLEMENTATION
 * is the one legitimate console call in the system. Packages whose shipped
 * surface is a terminal (coverage gates, parity CLIs) opt those files out
 * with an inline disable that names the reason — the same posture as every
 * other exception in this repo: a sentence, not a silence.
 *
 *     import { observabilityConfig } from "@12-apps/eslint-config/observability";
 *     export default [...baseConfig, ...observabilityConfig];
 */

/** @type {import("eslint").Linter.Config[]} */
export const observabilityConfig = [
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    ignores: [
      "src/**/__tests__/**",
      "src/**/*.test.*",
      "src/**/*.spec.*",
      "src/**/*.stories.*",
      "src/e2e/**",
    ],
    rules: {
      "no-console": "error",
    },
  },
];
