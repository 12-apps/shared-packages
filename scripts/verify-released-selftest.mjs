#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves scripts/verify-released.mjs catches BOTH ways a package stops
 * releasing, and stays quiet about the two states that merely look like them.
 *
 * The check guarded one direction for its whole life — a tag for a version npm
 * does not have. The mirror image, a published version with no tag, ended the
 * same way (semantic-release re-cuts the version, npm refuses it, publish.mjs
 * reports "skipped", the run is green and nothing ships) and was invisible,
 * because `releaseState` skipped every untagged package before asking the
 * registry anything. `@12-apps/request-scope` sat in that state after its
 * bootstrap run published 1.0.0 with a token and then failed to tag it.
 *
 * The two cases that must NOT fail carry as much weight as the two that must.
 * A package the registry has never seen has no tag by definition — that is
 * every package before its first release, and failing on it would turn adding a
 * package into a red run nobody can clear. And a package whose newest tag IS on
 * the registry is simply healthy.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify-released.mjs");

/** A `git` that answers `tag --list <prefix>-v*` from the plan. */
const FAKE_GIT = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "tag" && args[1] === "--list") {
  const pkg = args[2].replace(/-v\\*$/, "");
  const entry = plan[pkg];
  if (entry && entry.tag) process.stdout.write(entry.tag + "\\n");
}
process.exit(0);
`;

/** An `npm view` that answers from the plan; no `versions` means "not on the registry". */
const FAKE_NPM = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "view") {
  const pkg = args[1].replace(/^@selftest\\//, "");
  const entry = plan[pkg];
  if (!entry || !entry.versions) process.exit(1);
  process.stdout.write(JSON.stringify(entry.versions));
}
process.exit(0);
`;

/** Runs the real scripts/verify-released.mjs over a scripted git and npm. */
function verify(plan, env = {}) {
  const root = mkdtempSync(join(tmpdir(), "verify-released-selftest-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  for (const [name, source] of [
    ["git", FAKE_GIT],
    ["npm", FAKE_NPM],
  ]) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }

  const dirs = Object.keys(plan).map((pkg) => {
    const dir = join(root, pkg);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@selftest/${pkg}` }));
    return dir;
  });

  const planFile = join(root, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));

  const run = spawnSync(process.execPath, [VERIFY], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dirs.join(" "),
      FAKE_PLAN: planFile,
      GITHUB_STEP_SUMMARY: "",
      PUBLISH_INCOMPLETE: "",
      PUBLISH_WEDGED: "",
      ...env,
    },
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
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

// ── The mirror of an orphan: published, with no tag ──────────────────────────
const untagged = verify({ scope: { versions: ["1.0.0"] } });

check(
  "a published package with no tag fails the check",
  untagged.status !== 0,
  `this is the silent one — a green run here means the next release is swallowed.\n    ` +
    `Output:\n    ${untagged.output}`,
);

check(
  "it names the version the registry actually has",
  /1\.0\.0/.test(untagged.output),
  `the reader needs the version to tag; without it the remedy is guesswork.\n    Output:\n    ${untagged.output}`,
);

check(
  "it tells the reader to CREATE a tag, never to delete one",
  /git tag scope-v1\.0\.0/.test(untagged.output) && !/--delete/.test(untagged.output),
  `an orphan is fixed by deleting a tag and this by creating one. Printing the\n    ` +
    `orphan remedy here would send someone to delete a tag that does not exist.\n    ` +
    `Output:\n    ${untagged.output}`,
);

check(
  "it says the failure is SILENT, not merely present",
  /green|silent/i.test(untagged.output),
  `"stuck" alone reads as the loud orphan case; the point of this one is that\n    ` +
    `every step reports success. Output:\n    ${untagged.output}`,
);

// ── The newest published version wins, not the last one published ────────────
const outOfOrder = verify({ scope: { versions: ["1.9.0", "1.10.0", "1.9.1"] } });

check(
  "the remedy names the version-ordered newest, not the publication-ordered last",
  /git tag scope-v1\.10\.0/.test(outOfOrder.output),
  `npm lists versions in PUBLICATION order, so a patch on an older line lands\n    ` +
    `last. Tagging 1.9.1 would set the floor below a release already out.\n    ` +
    `Output:\n    ${outOfOrder.output}`,
);

// ── The orphan direction still works ─────────────────────────────────────────
const orphan = verify({ scope: { tag: "scope-v2.0.0", versions: ["1.0.0"] } });

check(
  "a tag for a version the registry lacks still fails",
  orphan.status !== 0 && /--delete/.test(orphan.output),
  `the direction this check has always guarded must survive the new one.\n    Output:\n    ${orphan.output}`,
);

// ── The two that must stay QUIET ─────────────────────────────────────────────
const brandNew = verify({ scope: {} });

check(
  "a package the registry has never seen does not fail",
  brandNew.status === 0,
  `every package looks like this before its first release. Failing here would\n    ` +
    `make adding a package a red run nobody can clear. Output:\n    ${brandNew.output}`,
);

const healthy = verify({ scope: { tag: "scope-v1.0.0", versions: ["1.0.0"] } });

check(
  "a package whose newest tag is on the registry does not fail",
  healthy.status === 0,
  `Output:\n    ${healthy.output}`,
);

console.log(
  failures === 0
    ? "\nverify-released.mjs catches both directions and stays quiet otherwise"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
