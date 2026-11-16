// Which publishable packages does a pull request ADD?
//
// WHY: a package's first publish goes out through the NPM_TOKEN bootstrap
// (scripts/first-publish.mjs), and its NEXT release is refused by OIDC until a
// Trusted Publisher is registered on npmjs.com. The only notice used to be the
// release run's step summary, after the merge, which nobody reads. This answers
// the question while the PR is still open.
//
// "Publishable" is whatever the release itself reads: release-packages.txt (see
// ./release-state.mjs). Nothing here re-derives that list, it only compares two
// readings of it — the base's and the head's.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** `{ name, private }` of a package directory, or null when it has no readable manifest. */
function readManifest(dir) {
  try {
    const { name, private: isPrivate } = JSON.parse(
      readFileSync(join(resolve(dir), "package.json"), "utf8"),
    );
    return typeof name === "string" ? { name, private: isPrivate === true } : null;
  } catch {
    return null;
  }
}

/**
 * The packages `headDirs` adds to the published set, as `[{ dir, name }]`.
 *
 * - `baseDirs` / `headDirs`: the publishable directories before and after.
 * - `manifestOf(dir)`: `{ name, private }` or null (injectable for tests).
 * - `existsOnRegistry(name)`: optional, resolves true only when npm is KNOWN to
 *   have the name. A throw or `false` both read as "new in this PR", so an
 *   offline run still warns; the registry can only take names OFF the list.
 *
 * A `private` package is never reported (npm refuses to publish it), nor is a
 * listed directory without a manifest.
 */
export async function newPackages({
  baseDirs,
  headDirs,
  manifestOf = readManifest,
  existsOnRegistry = null,
}) {
  const base = new Set(baseDirs);
  const found = [];
  for (const dir of headDirs) {
    if (base.has(dir)) continue;
    const manifest = manifestOf(dir);
    if (!manifest || manifest.private) continue;
    if (existsOnRegistry) {
      let known = false;
      try {
        known = (await existsOnRegistry(manifest.name)) === true;
      } catch {
        known = false;
      }
      if (known) continue;
    }
    found.push({ dir, name: manifest.name });
  }
  return found;
}

/** The exact steps, as markdown, for the step summary and the comment. */
export function registrationSteps(name) {
  return [
    `1. Open https://www.npmjs.com/package/${name}/access once the package has its first publish.`,
    "2. Settings → Trusted Publisher → GitHub Actions.",
    "3. Repository `12-apps/shared-packages`, workflow **`cd.yml`** (not `ci.yml`), no environment.",
    "4. Save. Without this, the release AFTER the first one is refused by OIDC.",
  ].join("\n");
}
