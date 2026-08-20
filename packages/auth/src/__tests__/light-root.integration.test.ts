import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The package ROOT must not drag a runtime in.
 *
 * `.` is the pure half — the e-mail + password flow, the password policy, the
 * token primitives, the admin allowlist, the limiter, device detection. The
 * Auth.js bridge lives in `./server`, which is report-builder's split and the
 * reason for it: a background job that expires stale tokens imports `hashToken`
 * and should load nothing else.
 *
 * Named `.integration.` for the FILESYSTEM, not for a database: it reads this
 * package's real source tree, which is precisely what it is asserting about. A
 * mocked `fs` would leave it testing the mock. The repo's tier for a test that
 * legitimately touches the disk is `INTEGRATION_GLOBS` in
 * `eslint.quality.shared.mjs`, and it still runs in the ordinary unit lane.
 *
 * This is a STATIC check over the import graph rather than a runtime one,
 * because the thing being asserted is what a bundler would pull in. A runtime
 * probe would also pass for a module that is imported but never executed, which
 * is exactly the case that costs a consumer bytes.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every relative module reachable from an entry, following VALUE imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(readFileSync(join(SRC, file), "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const next = resolve(file, spec);
      if (next !== null) stack.push(next);
    }
  }
  return [...seen];
}

/**
 * Import specifiers that survive to runtime.
 *
 * `import type { X }` is erased by the compiler, so it costs nothing and must
 * not fail this test — a type from `@auth/core` is fine to name anywhere.
 */
function valueImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((spec): spec is string => spec !== undefined);
}

function resolve(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(join(SRC, base + suffix))) return base + suffix;
  }
  return null;
}

describe("the package root stays light", () => {
  it("never value-imports @auth/core, directly or transitively", () => {
    // The one that matters. `.` used to import Auth.js at the top and apply the
    // AUTH_* env defaults as a module side effect, so `import { hashToken }`
    // loaded the whole framework and mutated config from the environment.
    const offenders = reachable("index.ts").filter((file) =>
      valueImports(readFileSync(join(SRC, file), "utf8")).some((s) =>
        s.startsWith("@auth/core"),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("never reaches a NODE BUILTIN — the root has to run in a browser", () => {
    // The one this test did not have, and the omission shipped a broken build.
    //
    // `.` was treated as light because it pulled no runtime PEER. But
    // `password.ts` and `tokens.ts` import `node:crypto`, and `@12-apps/app-shell`
    // value-imports this root from a BROWSER bundle to get `detectAppleDevice`.
    // Vite externalises `node:crypto`, Rollup then cannot find `scrypt` in the
    // browser shim, and every SPA build fails. A peer is not the only way to bind
    // a runtime; a builtin is the other, and it is the one a bundler cannot shim.
    const offenders = reachable("index.ts").flatMap((file) =>
      valueImports(readFileSync(join(SRC, file), "utf8"))
        .filter((spec) => spec.startsWith("node:"))
        .map((spec) => `${file} -> ${spec}`),
    );

    expect(offenders).toEqual([]);
  });

  it("never reaches react, react-dom or hono either", () => {
    // Same rule, the other peers. An entry point marks a PEER boundary here, so
    // the root reaching one would mean the boundary is in the wrong place.
    const heavy = ["react", "react-dom", "hono", "@playwright/test", "playwright-bdd"];
    const offenders = reachable("index.ts").flatMap((file) =>
      valueImports(readFileSync(join(SRC, file), "utf8"))
        .filter((s) => heavy.includes(s))
        .map((s) => `${file} -> ${s}`),
    );

    expect(offenders).toEqual([]);
  });

  it("holds the same line for ./react — the entry an SPA actually imports", () => {
    // The root is browser-safe only because `@12-apps/app-shell` reaches it.
    // `./react` is reached by every SPA directly and by definition renders in a
    // browser, so it has strictly more to lose. Guarded here rather than assumed:
    // the root's version of this rule was assumed once, and the assumption
    // shipped a build that could not bundle.
    const heavy = ["hono", "@playwright/test", "playwright-bdd"];
    const offenders = reachable("react/index.ts").flatMap((file) => {
      const specs = valueImports(readFileSync(join(SRC, file), "utf8"));
      return [
        ...specs.filter((s) => s.startsWith("node:")).map((s) => `${file} -> ${s}`),
        ...specs.filter((s) => heavy.includes(s)).map((s) => `${file} -> ${s}`),
      ];
    });

    expect(offenders).toEqual([]);
  });

  it("keeps ./manifest pure DATA — every runtime holds it, so nothing may be heavy", () => {
    // The shared manifest is what a browser bundle, a worker and a server all
    // import in order to READ what this package provides. The two runtime
    // manifests beside it carry the factories and are deliberately separate
    // entry points; if the shared one ever reached one of them, declaring a
    // capability would drag React into a worker and `node:crypto` into a
    // browser — the exact failure that shipped 2.0.0 unbundlable.
    const heavy = ["react", "react-dom", "hono", "@auth/core"];
    const offenders = reachable("manifest/index.ts").flatMap((file) =>
      valueImports(readFileSync(join(SRC, file), "utf8"))
        .filter((spec) => spec.startsWith("node:") || heavy.includes(spec))
        .map((spec) => `${file} -> ${spec}`),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the bridge reachable from ./server, so it did not merely vanish", () => {
    // Guards the other direction: a root that passed the two tests above by
    // DELETING the bridge would be a regression, not a fix.
    const server = reachable("server/index.ts");
    const reachesAuthCore = server.some((file) =>
      valueImports(readFileSync(join(SRC, file), "utf8")).some((s) =>
        s.startsWith("@auth/core"),
      ),
    );

    expect(reachesAuthCore).toBe(true);
  });
});
