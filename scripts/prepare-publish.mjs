// Rewrite `workspace:*` (and workspace:^ / workspace:~) interdependencies to the
// concrete sibling versions before `npm publish` — npm, unlike pnpm, does not
// understand the workspace protocol, so a published manifest must carry real
// version ranges. Run AFTER semantic-release, which is what creates the tags the
// sibling versions below are read from.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const PKGS = new URL("../packages/", import.meta.url).pathname;
const MF = "package.json";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const WS = /^workspace:(.*)$/;

function manifestAt(dir) {
  const mf = join(dir, MF);
  return existsSync(mf) ? [{ dir, mf, pkg: JSON.parse(readFileSync(mf, "utf8")) }] : [];
}

function subdirectories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name));
}

// `packages/<pkg>` AND one level deeper (`packages/payments/<pkg>`): a package
// group ships its halves as a nested workspace, and missing them here would
// publish a manifest still carrying `workspace:*` — which npm cannot resolve,
// so the package installs broken rather than failing loudly at publish time.
function readManifests() {
  const top = subdirectories(PKGS);
  return [...top, ...top.flatMap(subdirectories)].flatMap(manifestAt);
}

// The version a sibling will carry on the registry after this run, read from the
// git tags rather than from its manifest.
//
// WHY not the manifest. semantic-release writes a version into package.json only
// for the packages it actually releases, and the versions committed here are
// frozen at 1.0.0 — nothing commits a bump back. That was survivable only while
// every package was released on every run, which left the whole working tree
// fresh by the time this script ran. Now that releases are scoped to the
// directory they touch, an untouched package keeps its committed 1.0.0, and
// reading the manifest would publish `^1.0.0` for a sibling that is really at
// 1.17.0 — a range wide enough for npm to resolve the dependency back to a
// version predating everything the dependent was built against.
//
// semantic-release tags a release before this script runs, so a package released
// in this run is already tagged at its new version, and one that was not still
// carries the tag from whichever release put it on the registry.
//
// Tags are `<directory-basename>-v<version>` — the --tag-format ci.yml passes,
// which is NOT the npm package name. Prereleases are ignored on purpose: releases
// only ever come off `main`, so a suffixed tag is not something this pipeline
// produced.
const TAG = /^(.+)-v(\d+)\.(\d+)\.(\d+)$/;

function parseTag(tag) {
  const m = TAG.exec(tag.trim());
  return m ? { name: m[1], parts: [Number(m[2]), Number(m[3]), Number(m[4])] } : null;
}

function isNewer(a, b) {
  const i = a.findIndex((n, index) => n !== b[index]);
  return i !== -1 && a[i] > b[i];
}

function keepLatest(latest, { name, parts }) {
  if (!latest.has(name) || isNewer(parts, latest.get(name))) latest.set(name, parts);
  return latest;
}

function releasedVersions() {
  const tags = execFileSync("git", ["tag", "--list"], { encoding: "utf8" }).split("\n");
  const latest = tags.map(parseTag).filter(Boolean).reduce(keepLatest, new Map());
  return new Map([...latest].map(([name, parts]) => [name, parts.join(".")]));
}

// A package with no tag at all has never been released, so nothing on the
// registry can depend on it yet and first-publish.mjs is what puts it there —
// its manifest version is the right answer. Say so, because the same silence
// would otherwise cover a tag scheme that had drifted out of sync with ci.yml.
function versionOf(entry, released) {
  const tagged = released.get(basename(entry.dir));
  if (tagged) return tagged;
  console.log(`${entry.pkg.name}: no release tag yet — using manifest version ${entry.pkg.version}`);
  return entry.pkg.version;
}

// workspace:* / workspace:^ -> ^v ; workspace:~ -> ~v ; workspace:<range> -> <range>
function toConcrete(range, version) {
  const m = WS.exec(range);
  if (!m) return null;
  const t = m[1];
  return t === "" || t === "*" || t === "^" ? `^${version}` : t === "~" ? `~${version}` : t;
}

// One loop, in its own function, so nothing is lexically nested.
function resolveField(owner, field, deps, versions) {
  let changed = false;
  for (const name of Object.keys(deps)) {
    const m = WS.exec(deps[name]);
    if (!m) continue;
    const v = versions.get(name);
    if (!v) throw new Error(`${owner}: ${field}.${name} is workspace but ${name} has no version`);
    const spec = toConcrete(deps[name], v);
    console.log(`${owner}: ${field}.${name} ${deps[name]} -> ${spec}`);
    deps[name] = spec;
    changed = true;
  }
  return changed;
}

function resolveManifest(entry, versions) {
  const touched = DEP_FIELDS
    .filter((field) => entry.pkg[field])
    .map((field) => resolveField(entry.pkg.name, field, entry.pkg[field], versions));
  if (touched.some(Boolean)) writeFileSync(entry.mf, JSON.stringify(entry.pkg, null, 2) + "\n");
}

const manifests = readManifests();
const released = releasedVersions();
const versions = new Map(manifests.map((e) => [e.pkg.name, versionOf(e, released)]));
manifests.forEach((e) => resolveManifest(e, versions));
console.log("workspace deps resolved for publish");
