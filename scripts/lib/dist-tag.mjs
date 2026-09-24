// Which npm dist-tag a release publishes under — and why a maintenance release
// must never take `latest`.
//
// cd.yml releases from `main` and from `release/<pkg>-<major>.<minor>.x`
// branches: semantic-release's maintenance branches, which a package opts into
// by naming the branch, its range and its channel in its .releaserc.json.
// `npm publish` with no `--tag` puts the version on `latest`, so a 5.8.2 cut
// from a maintenance branch after 5.11.0 shipped would move every unpinned
// install BACKWARDS — silently, with every step green. A maintenance branch
// therefore publishes on a dist-tag named after its line (`app-shell-5.8.x`),
// the same name its .releaserc.json declares as `channel` — which
// scripts/release-bump-selftest.mjs holds every package's config to.
//
// The branch is cd.yml's RELEASE_BRANCH — the ref it checked out. Unset or
// `main` is the ordinary release and keeps npm's default. Any other branch is
// REFUSED before a single publish: this must not guess a dist-tag for a branch
// nobody configured, and "fall back to latest" is the exact regression above.

/** `release/app-shell-5.8.x` → `app-shell-5.8.x`. Letters, digits and dashes, then a `.x` line. */
const MAINTENANCE_BRANCH = /^release\/([a-z0-9][a-z0-9-]*-\d+\.\d+\.x)$/;

/**
 * The extra `npm publish` arguments for a branch (cd.yml's RELEASE_BRANCH by
 * default): `[]` on main, `["--tag", "<line>"]` on a maintenance branch.
 * Throws for any other branch.
 */
export function distTagArgs(branch = process.env.RELEASE_BRANCH ?? "") {
  if (branch === "" || branch === "main") return [];
  const found = MAINTENANCE_BRANCH.exec(branch);
  if (!found) {
    throw new Error(
      `refusing to publish from branch "${branch}": only main and ` +
        "release/<pkg>-<major>.<minor>.x maintenance branches publish, and no " +
        "dist-tag is chosen for any other",
    );
  }
  return ["--tag", found[1]];
}
