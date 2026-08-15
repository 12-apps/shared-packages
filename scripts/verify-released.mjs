// Fail when a package has a release TAG the registry never received.
//
// WHY this exists. `semantic-release` decides what to release by looking at the
// tags: the commit range for a package is "everything since its newest
// `<pkg>-v*` tag". Tagging and publishing are separate steps here —
// semantic-release runs with `npmPublish:false` and `scripts/publish.mjs` does
// the upload over OIDC — so a run that dies between them leaves a tag for a
// version npm does not have.
//
// That state is self-perpetuating and SILENT. On every later run
// semantic-release sees its own tag, concludes the package has nothing new, and
// leaves `package.json` at the repo's committed version; `publish.mjs` then
// finds that version already on the registry and reports "skipped". Both steps
// succeed. The package simply never releases again, and nothing says so.
//
// It has happened: `auth-v1.22.0` was tagged by the run that shipped
// `createWebAuth`, that run then failed pushing to git, and `@12-apps/auth` sat
// at 1.21.0 while every subsequent release reported success. A consumer found
// it, two repositories away, as `Cannot find module '@12-apps/auth/react'`.
//
// The remedy for an orphan left by an EARLIER run is always the same and the
// message below prints it: delete the orphaned tag (and its GitHub Release) so
// the next run re-cuts that version.
//
// It is the wrong remedy for an orphan THIS run just made, and this step now
// runs on failure (`if: always()`) precisely so it sees those. Deleting the tag
// of a package whose publish failed minutes ago only re-cuts the version into
// the same failure — and when the failure was "npm obtained no credential",
// nothing about a re-run changes it. scripts/publish.mjs therefore hands over
// the names it did not get onto the registry (PUBLISH_INCOMPLETE, and the
// no-credential subset PUBLISH_WEDGED) and those orphans get the remedy in the
// right ORDER: fix the publish first, delete the tag second.
import { appendFileSync } from "node:fs";

import { handedOver, publishDirs, releaseState } from "./lib/release-state.mjs";

const DIRS = publishDirs();

const INCOMPLETE = handedOver("PUBLISH_INCOMPLETE");
const WEDGED = handedOver("PUBLISH_WEDGED");

function report(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Released-tag verification", "", ...lines.map((l) => `- ${l}`), ""].join("\n"),
  );
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to verify");

const { orphans, unpublished, healthy } = releaseState(DIRS);

const lines = [`${healthy.length + orphans.length} package(s) verified against the registry`];
if (unpublished.length > 0) {
  lines.push(
    `not yet on the registry, skipped: ${unpublished
      .map(({ name, tag }) => `${name} (tagged ${tag}, not on the registry yet)`)
      .join(", ")}`,
  );
}

/**
 * What to do about one orphan — which depends on whether THIS run made it.
 *
 * The tag deletion is the last move in every case; what changes is what has to
 * happen before it, and saying "delete the tag and re-run" to someone whose
 * publish step failed ten lines above sends them round the same loop.
 */
function remedy(name, tag) {
  const del = `git push origin --delete ${tag}`;
  if (WEDGED.has(name)) {
    return (
      `This run's publish could not authenticate for ${name} at all, which is what ` +
      `left the tag behind — see the Publish step's annotation for what npm ` +
      `reported. Deleting the tag now only re-cuts the version into the same ` +
      `failure, and a plain re-run will not fix it either. Fix the credential ` +
      `first; then delete the orphaned tag and its GitHub Release: ${del}`
    );
  }
  if (INCOMPLETE.has(name)) {
    return (
      `This run's publish did not get ${name} onto the registry, which is what left ` +
      `the tag behind. Fix that failure first; then delete the orphaned tag and its ` +
      `GitHub Release: ${del}`
    );
  }
  return `Delete the orphaned tag and its GitHub Release, then re-run: ${del}`;
}

for (const { name, tag, version } of orphans) {
  console.log(
    `::error::${name} is tagged ${tag} but ${version} is not on the registry. ` +
      `Releases for this package are STUCK: semantic-release sees the tag and ` +
      `cuts nothing. ${remedy(name, tag)}`,
  );
  const caveat = WEDGED.has(name) || INCOMPLETE.has(name) ? " (this run's publish failed for it)" : "";
  lines.push(`**stuck**: ${name} tagged ${tag}, ${version} absent from the registry${caveat}`);
}

report(lines);

if (orphans.length > 0) process.exitCode = 1;
