// Fail when a package's tags and the registry disagree, in EITHER direction:
// a release TAG the registry never received, or a published VERSION no tag
// records. Both end with the package silently never releasing again; they need
// opposite remedies, so they are reported separately at the bottom of this file.
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

import { handedOver, newestPublished, publishDirs, releaseState } from "./lib/release-state.mjs";

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

const { orphans, untagged, unpublished, healthy } = releaseState(DIRS);

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

/**
 * The mirror of an orphan: a version on the registry that no tag records.
 *
 * Same ending as an orphan — the package stops releasing — but reached from the
 * other side and, until this check existed, reached SILENTLY. semantic-release
 * counts from the newest `<pkg>-v*` tag; with none it treats the next release as
 * the package's first, re-cuts the version already on npm, and publish.mjs
 * reports "skipped" because that version exists. Green run, nothing shipped.
 *
 * The remedy is the opposite of an orphan's. Do NOT delete anything: the tag is
 * what is missing. Point it at the commit whose release produced that version,
 * which is the merge the package's release notes were generated from. Tagging a
 * later commit is not wrong so much as lossy — the tag's only job is to give
 * semantic-release a floor, and a floor set too late just narrows the NEXT
 * release's commit range.
 */
function untaggedRemedy(prefix, version) {
  return (
    `Create the missing tag at the commit whose release published ${version}, ` +
    `then push it: git tag ${prefix}-v${version} <commit> && ` +
    `git push origin ${prefix}-v${version}`
  );
}

for (const { name, prefix, versions } of untagged) {
  const version = newestPublished(versions);
  console.log(
    `::error::${name} is on the registry at ${version} but has no ${prefix}-v* tag. ` +
      `Releases for this package are STUCK, and silently: semantic-release has no ` +
      `floor to count from, so it re-cuts ${version}, npm refuses a version it ` +
      `already has, and the run stays green while nothing ships. ` +
      `${untaggedRemedy(prefix, version)}`,
  );
  lines.push(`**stuck**: ${name} published ${version} with no ${prefix}-v* tag recording it`);
}

report(lines);

if (orphans.length > 0 || untagged.length > 0) process.exitCode = 1;
