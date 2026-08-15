// Heal a package whose release tag the registry never received, before this run
// releases anything.
//
// WHY this runs FIRST, ahead of semantic-release. An orphaned tag is not merely
// a stale record — it is what STOPS the package releasing. semantic-release
// decides what to cut from the newest `<pkg>-v*` tag, so a tag for a version npm
// does not have makes it conclude there is nothing new, forever. Deleting that
// tag here means semantic-release re-cuts the same version later in this very
// job and scripts/publish.mjs uploads it: one merge, and the package is
// unstuck, with correct release notes because the commit range comes back too.
//
// Running it last instead would still work, but only via the NEXT merge — and
// "the next merge" is how `auth-v1.22.0` stayed broken for four days.
//
// WHY deleting a tag from CI is the safe move here, and not the reckless one it
// sounds like. The tag names a version that does not exist on the registry, so
// nothing can be depending on it: `npm i @12-apps/auth@1.22.0` was already an
// error. Re-cutting restores the tag, the GitHub Release and the release notes
// within the same job. The failure mode is not data loss, it is churn — see
// below.
//
// WHAT this deliberately does NOT do: publish the tagged commit's tree as the
// missing version. The tagged commit is an ancestor of HEAD, so that tarball
// would be neither what the tag says nor what main contains, and its release
// notes would already have been consumed. Re-cutting is the honest route to the
// same version number.
//
// CHURN, and why it is acceptable. A package that is genuinely unpublishable —
// the standing example is a name whose Trusted Publisher was never configured,
// so scripts/publish.mjs can never authenticate for it — will have its tag
// deleted and re-cut on every push to main. That is noisy, and it is still
// better than the alternative it replaces: the run is RED each time and
// scripts/release-alert.mjs holds an issue open, where the old behaviour was a
// package that silently never released again. It stops the moment the publish
// works. Set RELEASE_AUTO_RECOVER=false to disable and report only.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { publishDirs, releaseState } from "./lib/release-state.mjs";

const DIRS = publishDirs();
const ENABLED = process.env.RELEASE_AUTO_RECOVER !== "false";
const REPO = process.env.GITHUB_REPOSITORY ?? "";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

function git(args) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}`.trim(), err: `${run.stderr ?? ""}`.trim() };
}

// Set on every Actions runner, and different on Enterprise Server — so reading
// it is both more correct than a hard-coded host and what makes this testable.
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

async function api(path, init = {}) {
  const response = await fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  return response;
}

/**
 * Remove the GitHub Release for a tag, if there is one.
 *
 * semantic-release creates the Release and pushes the tag as separate acts, so
 * either can exist without the other. A missing Release is therefore an ordinary
 * outcome and not a failure — the tag is the thing that has to go.
 */
async function deleteRelease(tag) {
  if (!TOKEN || !REPO) return "no GITHUB_TOKEN, left the GitHub Release in place";
  const found = await api(`/releases/tags/${tag}`);
  if (found.status === 404) return "no GitHub Release existed";
  if (!found.ok) return `could not look up the GitHub Release (HTTP ${found.status})`;
  const { id } = await found.json();
  const gone = await api(`/releases/${id}`, { method: "DELETE" });
  return gone.ok ? "deleted the GitHub Release" : `could not delete the GitHub Release (HTTP ${gone.status})`;
}

/**
 * Drop the tag remotely and locally.
 *
 * The LOCAL delete is not tidiness: semantic-release runs later in this same
 * checkout and reads tags from it, so a tag left locally would keep the package
 * looking released and defeat the entire point of this script.
 */
function deleteTag(tag) {
  const remote = git(["push", "origin", "--delete", tag]);
  if (!remote.ok) return { ok: false, note: `could not delete the remote tag: ${remote.err}` };
  git(["tag", "-d", tag]);
  return { ok: true, note: "deleted the tag locally and on the remote" };
}

function summarize(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Orphaned-tag recovery", "", ...lines.map((line) => `- ${line}`), ""].join("\n"),
  );
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to recover");

// `releaseState` keeps a name the registry has never seen OUT of `orphans` — it
// is a first publish, which scripts/first-publish.mjs owns, and deleting the tag
// of a package that is merely new would be a fine way to invent this bug.
const { orphans } = releaseState(DIRS);

if (orphans.length === 0) {
  summarize(["no orphaned release tags — every package's newest tag is on the registry"]);
} else if (!ENABLED) {
  summarize([
    "RELEASE_AUTO_RECOVER=false, so these were reported and left alone:",
    ...orphans.map((o) => `${o.name} is tagged ${o.tag}, which the registry does not have`),
  ]);
} else {
  const lines = [];
  for (const { name, tag, version } of orphans) {
    // Nothing has been tagged yet in this run, so every orphan found here was
    // left by an EARLIER one — which is exactly the case whose remedy is to
    // delete the tag. The orphans a run makes itself are a different problem
    // with the opposite remedy, and scripts/verify-released.mjs handles those.
    const releaseNote = await deleteRelease(tag);
    const { ok, note } = deleteTag(tag);
    if (ok) {
      console.log(
        `::warning::${name} was tagged ${tag} but ${version} never reached the registry. ` +
          `Recovered: ${note}, ${releaseNote}. semantic-release will re-cut ${version} in this run.`,
      );
      lines.push(`**recovered**: ${name} — removed the orphaned ${tag}, re-cutting ${version} now`);
    } else {
      console.log(`::error::${name} is tagged ${tag} but ${version} is not on the registry, and ${note}`);
      lines.push(`**stuck**: ${name} tagged ${tag} — ${note}`);
      process.exitCode = 1;
    }
  }
  summarize(lines);
}
