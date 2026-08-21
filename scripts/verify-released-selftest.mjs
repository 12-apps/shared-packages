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
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "view") {
  // Look the entry up by its npm NAME, which a fixture may set independently of
  // its directory key — the two differ for real packages.
  const key = Object.keys(plan).find(
    (k) => (plan[k].npmName || "@selftest/" + k) === args[1],
  );
  const entry = key ? plan[key] : null;
  if (!entry || !entry.versions) process.exit(1);
  // \`lateVersion\` models npm's read-after-write lag: the registry has accepted
  // the publish but does not serve it until a later read. \`lateAfter\` reads are
  // answered without it, everything after includes it.
  let versions = entry.versions;
  if (entry.lateVersion) {
    const counts = existsSync(process.env.FAKE_NPM_CALLS)
      ? JSON.parse(readFileSync(process.env.FAKE_NPM_CALLS, "utf8"))
      : {};
    counts[key] = (counts[key] || 0) + 1;
    writeFileSync(process.env.FAKE_NPM_CALLS, JSON.stringify(counts));
    if (counts[key] > (entry.lateAfter || 1)) versions = [...versions, entry.lateVersion];
  }
  process.stdout.write(JSON.stringify(versions));
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

  // `npmName` lets a fixture make the DIRECTORY basename differ from the npm
  // name, which is the only shape that can catch `prefix` and `name` being
  // swapped. It is not hypothetical: `packages/payments/backend` publishes as
  // `@12-apps/payments-backend`, so its tags are `backend-v*`. With every
  // fixture named after its own directory the two are interchangeable and the
  // suite passes either way.
  const dirs = Object.keys(plan).map((pkg) => {
    const dir = join(root, pkg);
    mkdirSync(dir);
    const npmName = plan[pkg].npmName ?? `@selftest/${pkg}`;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: npmName }));
    return dir;
  });

  const planFile = join(root, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));
  const npmCalls = join(root, "npm-calls.json");
  writeFileSync(npmCalls, "{}");

  const run = spawnSync(process.execPath, [VERIFY], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dirs.join(" "),
      FAKE_PLAN: planFile,
      FAKE_NPM_CALLS: npmCalls,
      // No waiting unless a case asks for it. The re-read schedule is minutes
      // long by design (lib/release-state.mjs), which is right in CI and would
      // make this suite unrunnable.
      RELEASE_ABSENCE_RECHECK_MS: "",
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

const bootstrapped = verify(
  { scope: { versions: ["1.0.0"] } },
  { FIRST_PUBLISHED: "@selftest/scope" },
);

check(
  "a package THIS run first-published is reported but does not fail",
  bootstrapped.status === 0 && /first published this run/.test(bootstrapped.output),
  `first-publish.mjs puts a new name on the registry earlier in the same job, so it\n    ` +
    `is untagged by construction until a release cuts one. Failing here makes ADDING\n    ` +
    `a package a red run its author cannot clear. Output:\n    ${bootstrapped.output}`,
);

// ── A prerelease must never be chosen as the newest ──────────────────────────
const prerelease = verify({ scope: { versions: ["1.0.0-beta.1", "1.0.0"] } });

check(
  "the remedy prefers a release over its own prerelease",
  /git tag scope-v1\.0\.0 /.test(prerelease.output),
  `semver puts 1.0.0-beta.1 BELOW 1.0.0; a numeric-collation sort puts it above.\n    ` +
    `Tagging the prerelease sets the floor below a release already out, and the\n    ` +
    `package then reads healthy for ever while nothing ships — the exact silent\n    ` +
    `failure this check exists to catch. Output:\n    ${prerelease.output}`,
);

const acrossMajors = verify({ scope: { versions: ["2.0.0-alpha.1", "1.5.0"] } });

check(
  "a prerelease of a FUTURE major does not outrank the current release",
  /git tag scope-v2\.0\.0-alpha\.1 /.test(acrossMajors.output),
  `2.0.0-alpha.1 really is newer than 1.5.0 — the prerelease rule only demotes it\n    ` +
    `below its OWN release, 2.0.0. Output:\n    ${acrossMajors.output}`,
);

// ── prefix (directory) vs name (npm) must not be interchangeable ─────────────
const nested = verify({
  backend: { npmName: "@selftest/payments-backend", versions: ["1.0.0"] },
});

check(
  "the tag uses the DIRECTORY basename, not the npm name",
  /git tag backend-v1\.0\.0 /.test(nested.output) &&
    !/payments-backend-v/.test(nested.output),
  `packages/payments/backend publishes as @12-apps/payments-backend and is tagged\n    ` +
    `backend-v*. Every other fixture has basename === name suffix, so without this\n    ` +
    `case swapping prefix for name passes the whole suite. Output:\n    ${nested.output}`,
);

check(
  "and it still names the npm package in the error",
  /@selftest\/payments-backend/.test(nested.output),
  `the reader identifies the package by its npm name. Output:\n    ${nested.output}`,
);

// ── A name on the registry with NO versions left ─────────────────────────────
//
// Reserved `null` means "npm has never heard of this name", so a name whose
// versions were all unpublished arrives as `[]` instead — published-looking,
// with nothing published. Treating that as untagged makes the remedy
// interpolate `newestPublished`'s null into a tag NAME and print "create
// scope-vnull" at a human, which is the churn loop recover-orphans.mjs guards
// against, reached through the reader rather than the automation.
const noVersions = verify({ scope: { versions: [] } });

check(
  "a name with no versions left is not reported as untagged",
  noVersions.status === 0,
  `there is no published version to record, so nothing is stuck. Output:\n    ${noVersions.output}`,
);

check(
  "and it never advises creating a -vnull tag",
  !/vnull|at null|published null/.test(noVersions.output),
  `interpolating a null version into a tag name is defect #3 aimed at a human:\n    ` +
    `the tag names a version that does not exist, so the next run reads it back as\n    ` +
    `an orphan and deletes it. Output:\n    ${noVersions.output}`,
);

// ── The orphan handoff branches ─────────────────────────────────────────────
const wedged = verify(
  { scope: { tag: "scope-v2.0.0", versions: ["1.0.0"] } },
  { PUBLISH_WEDGED: "@selftest/scope" },
);

check(
  "an orphan THIS run failed to publish says so instead of advising a re-cut",
  /this run's publish failed for it/.test(wedged.output),
  `"delete the tag and re-run" is right for an orphan left by an EARLIER run and\n    ` +
    `wrong for one this run just made — re-cutting walks back into the same\n    ` +
    `failure. Output:\n    ${wedged.output}`,
);

// ── The registry's read-after-write lag ─────────────────────────────────────
//
// The failure this suite could not see, and the one that actually happened.
// npm answers `publish` with `ok` before it serves the version, so the read
// immediately afterwards can be honestly, temporarily wrong. A single read
// turns that into "STUCK" and prints `git push origin --delete` at whoever is
// watching — @12-apps/feature-flags collected that verdict twice in one night,
// for 2.0.0 and 2.0.1, both of which npm was serving minutes later. Following
// the advice would have deleted a good tag and spent a version re-cutting
// something already published.
//
// `lateVersion` is that registry: absent on the first read, present after it.
const propagating = verify(
  { scope: { tag: "scope-v2.0.0", versions: ["1.0.0"], lateVersion: "2.0.0" } },
  { RELEASE_ABSENCE_RECHECK_MS: "1,1,1" },
);

check(
  "a version the registry serves on a re-read is not called stuck",
  propagating.status === 0,
  `a publish that has not propagated yet is not an orphan, and the remedy for an\n    ` +
    `orphan destroys a healthy tag. Output:\n    ${propagating.output}`,
);

check(
  "and it never advises deleting that tag",
  !/--delete/.test(propagating.output),
  `printing the delete remedy is the whole harm — the run is red and the reader\n    ` +
    `is told to throw away a tag npm is about to serve. Output:\n    ${propagating.output}`,
);

// The other half of the contract: patience must not become blindness. A
// genuinely orphaned tag has to survive the re-reads and still fail, or this
// fix trades a false alarm for a silent one — which is the failure mode the
// whole module exists to end.
const stillAbsent = verify(
  { scope: { tag: "scope-v2.0.0", versions: ["1.0.0"] } },
  { RELEASE_ABSENCE_RECHECK_MS: "1,1,1" },
);

check(
  "a version that never arrives still fails after the re-reads",
  stillAbsent.status !== 0 && /--delete/.test(stillAbsent.output),
  `waiting is meant to remove false alarms, not real ones. Output:\n    ${stillAbsent.output}`,
);

check(
  "and it says it waited, so the reader can weigh the verdict",
  /re-read/i.test(stillAbsent.output),
  `"delete this tag" is a destructive instruction; it should carry the evidence\n    ` +
    `that propagation was ruled out. Output:\n    ${stillAbsent.output}`,
);

console.log(
  failures === 0
    ? "\nverify-released.mjs catches both directions and stays quiet otherwise"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
