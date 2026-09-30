#!/usr/bin/env node
/**
 * Proves scripts/prepare-publish.mjs reads sibling versions from the tags the
 * CHECKED-OUT branch can reach, not from every tag in the repository.
 *
 * cd.yml releases `main` and semantic-release maintenance branches
 * (`release/<pkg>-<major>.<minor>.x`, cut from an old tag), and its checkout
 * fetches every tag. prepare-publish rewrites `workspace:*` to `^<sibling's
 * version>`, so reading all tags would give a maintenance release the NEWEST
 * sibling from main — `@12-apps/app-shell` 5.8.2 would have required
 * `@12-apps/ui` ^6.32.0, the upgrade the 5.8.x line exists to avoid.
 *
 * Run through the REAL script, copied into a throwaway git repository shaped
 * like this one (`scripts/` beside `packages/`, since it resolves the packages
 * relative to itself): `dep` is tagged 1.0.0, a maintenance branch is cut
 * there, and main then tags 2.0.0.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(what, ok, detail) {
  if (ok) {
    console.log(`  ok  ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}\n    ${detail}`);
}

const root = mkdtempSync(join(tmpdir(), "prepare-publish-selftest-"));

function git(...args) {
  const run = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "selftest",
      GIT_AUTHOR_EMAIL: "selftest@example.invalid",
      GIT_COMMITTER_NAME: "selftest",
      GIT_COMMITTER_EMAIL: "selftest@example.invalid",
    },
  });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

function manifest(dir, pkg) {
  mkdirSync(join(root, "packages", dir), { recursive: true });
  writeFileSync(join(root, "packages", dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

mkdirSync(join(root, "scripts"));
copyFileSync(join(HERE, "prepare-publish.mjs"), join(root, "scripts", "prepare-publish.mjs"));
manifest("dep", { name: "@selftest/dep", version: "1.0.0" });
manifest("app", {
  name: "@selftest/app",
  version: "1.0.0",
  dependencies: { "@selftest/dep": "workspace:*" },
});
git("init", "--quiet", "--initial-branch=main");
git("add", ".");
git("commit", "--quiet", "--no-verify", "-m", "one");
git("tag", "dep-v1.0.0");
git("branch", "release/app-1.0.x");
git("commit", "--quiet", "--no-verify", "--allow-empty", "-m", "two");
git("tag", "dep-v2.0.0");

/** Check out `branch`, run the real script there, and return app's resolved dependency. */
function resolvedOn(branch) {
  git("checkout", "--quiet", "--force", branch);
  const run = spawnSync(process.execPath, [join(root, "scripts", "prepare-publish.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  const app = JSON.parse(readFileSync(join(root, "packages", "app", "package.json"), "utf8"));
  return { status: run.status, output: `${run.stdout}${run.stderr}`, dep: app.dependencies["@selftest/dep"] };
}

const line = resolvedOn("release/app-1.0.x");
check(
  "a maintenance branch pins the sibling version its own history released",
  line.status === 0 && line.dep === "^1.0.0",
  `exit ${line.status}, @selftest/dep resolved to ${line.dep} (want ^1.0.0 — dep-v2.0.0 is main's,\n    ` +
    `unreachable from this branch):\n${line.output}`,
);

const main = resolvedOn("main");
check(
  "main still pins the newest sibling",
  main.status === 0 && main.dep === "^2.0.0",
  `exit ${main.status}, @selftest/dep resolved to ${main.dep} (want ^2.0.0):\n${main.output}`,
);

console.log(
  failures === 0
    ? "\nprepare-publish reads the tags its own branch can reach"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
