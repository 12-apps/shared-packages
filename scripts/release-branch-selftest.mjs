#!/usr/bin/env node
/**
 * Proves scripts/release-tags.mjs tells semantic-release which branch cd.yml
 * checked out.
 *
 * semantic-release takes its branch from env-ci, which reads `GITHUB_REF` on
 * GitHub Actions — and cd.yml runs on `workflow_run`, where `GITHUB_REF` is the
 * default branch whichever branch's CI triggered it. Left alone, a maintenance
 * branch (`release/app-shell-5.8.x`) would be released as if it were `main`:
 * semantic-release would find the checkout is not main's head and cut nothing,
 * green. See releaseBranchEnv in ./lib/dist-tag.mjs.
 *
 * Run through the REAL script, with a `pnpm` shim on PATH that records the
 * `GITHUB_REF` each semantic-release call was given. The runner's value is
 * pinned to what workflow_run gives, so the case cannot pass by accident.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASED } from "./release-tags-selftest-fixtures.mjs";

const RELEASE_TAGS = join(dirname(fileURLToPath(import.meta.url)), "release-tags.mjs");

/** CommonJS and extensionless: release-tags.mjs spawns it as the bare word `pnpm`. */
const FAKE_PNPM = `#!/usr/bin/env node
require("node:fs").appendFileSync(process.env.FAKE_PNPM_REFS, (process.env.GITHUB_REF || "(unset)") + "\\n");
process.stdout.write(${JSON.stringify(RELEASED)} + "\\n");
`;

/** Release one package on `branch` and return what semantic-release was told. */
function releaseOn(branch) {
  const root = mkdtempSync(join(tmpdir(), "release-branch-selftest-"));
  const bin = join(root, "bin");
  const dir = join(root, "app-shell");
  const refs = join(root, "refs.log");
  mkdirSync(bin);
  mkdirSync(dir);
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  writeFileSync(join(bin, "pnpm"), FAKE_PNPM);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(join(dir, "package.json"), '{"name":"@selftest/app-shell","version":"1.0.0"}\n');
  writeFileSync(refs, "");
  const run = spawnSync(process.execPath, [RELEASE_TAGS], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dir,
      FAKE_PNPM_REFS: refs,
      GITHUB_STEP_SUMMARY: join(root, "summary.md"),
      GITHUB_ENV: join(root, "github.env"),
      GITHUB_REF: "refs/heads/main",
      RELEASE_BRANCH: branch,
    },
  });
  const seen = readFileSync(refs, "utf8").split("\n").filter(Boolean);
  return { status: run.status, output: `${run.stdout}${run.stderr}`, seen };
}

let failures = 0;
function check(what, ok, detail) {
  if (ok) {
    console.log(`  ok  ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}\n    ${detail}`);
}

const line = releaseOn("release/app-shell-5.8.x");
check(
  "a maintenance branch reaches semantic-release as that branch, not main",
  line.status === 0 && line.seen.join() === "refs/heads/release/app-shell-5.8.x",
  `exit ${line.status}; semantic-release saw GITHUB_REF as: ${line.seen.join(", ") || "(never ran)"}`,
);

const main = releaseOn("main");
check(
  "main reaches semantic-release exactly as before",
  main.status === 0 && main.seen.join() === "refs/heads/main",
  `exit ${main.status}; semantic-release saw GITHUB_REF as: ${main.seen.join(", ") || "(never ran)"}`,
);

const stray = releaseOn("feat/not-a-line");
check(
  "any other branch is refused before semantic-release runs",
  stray.status !== 0 && stray.seen.length === 0 && /refusing to publish/.test(stray.output),
  `exit ${stray.status} after ${stray.seen.length} semantic-release call(s):\n${stray.output}`,
);

console.log(
  failures === 0
    ? "\nsemantic-release is told the branch cd.yml checked out"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
