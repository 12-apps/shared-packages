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
// The remedy is always the same and the message below prints it: delete the
// orphaned tag (and its GitHub Release) so the next run re-cuts that version.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}`.trim() };
}

function manifestName(dir) {
  return JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8")).name;
}

/**
 * The newest `<prefix>-v*` tag, as a bare version.
 *
 * `--sort=-v:refname` is version-aware, which matters: lexically `v1.9.0` sorts
 * after `v1.22.0` and the check would compare against the wrong tag.
 */
function newestTag(prefix) {
  const { ok, out } = run("git", ["tag", "--list", `${prefix}-v*`, "--sort=-v:refname"]);
  if (!ok || out === "") return null;
  const tag = out.split("\n")[0];
  return { tag, version: tag.slice(`${prefix}-v`.length) };
}

/**
 * Every version on the registry, or `null` when the package is not there at all.
 *
 * A name the registry has never seen is NOT this check's business — that is a
 * first publish, which `scripts/first-publish.mjs` owns.
 */
function registryVersions(name) {
  const { ok, out } = run("npm", ["view", name, "versions", "--json"]);
  if (!ok) return null;
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function report(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Released-tag verification", "", ...lines.map((l) => `- ${l}`), ""].join("\n"),
  );
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to verify");

const orphans = [];
const checked = [];
const unpublished = [];

for (const dir of DIRS) {
  const prefix = basename(dir);
  const name = manifestName(dir);
  const tag = newestTag(prefix);
  if (!tag) continue;

  const versions = registryVersions(name);
  if (versions === null) {
    unpublished.push(`${name} (tagged ${tag.tag}, not on the registry yet)`);
    continue;
  }

  checked.push(name);
  if (!versions.includes(tag.version)) {
    orphans.push({ name, tag: tag.tag, version: tag.version });
  }
}

const lines = [`${checked.length} package(s) verified against the registry`];
if (unpublished.length > 0) {
  lines.push(`not yet on the registry, skipped: ${unpublished.join(", ")}`);
}

for (const { name, tag, version } of orphans) {
  console.log(
    `::error::${name} is tagged ${tag} but ${version} is not on the registry. ` +
      `Releases for this package are STUCK: semantic-release sees the tag and ` +
      `cuts nothing. Delete the orphaned tag and its GitHub Release, then ` +
      `re-run: git push origin --delete ${tag}`,
  );
  lines.push(`**stuck**: ${name} tagged ${tag}, ${version} absent from the registry`);
}

report(lines);

if (orphans.length > 0) process.exitCode = 1;
