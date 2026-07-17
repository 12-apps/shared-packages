// Rewrite `workspace:*` (and workspace:^ / workspace:~) interdependencies to the
// concrete sibling versions before `npm publish` — npm, unlike pnpm, does not
// understand the workspace protocol, so a published manifest must carry real
// version ranges. Run AFTER semantic-release has set each package.json version.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PKGS = new URL("../packages/", import.meta.url).pathname;
const MF = "package.json";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const WS = /^workspace:(.*)$/;

function readManifests() {
  return readdirSync(PKGS)
    .map((dir) => join(PKGS, dir, MF))
    .filter((mf) => existsSync(mf))
    .map((mf) => ({ mf, pkg: JSON.parse(readFileSync(mf, "utf8")) }));
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
const versions = new Map(manifests.map((e) => [e.pkg.name, e.pkg.version]));
manifests.forEach((e) => resolveManifest(e, versions));
console.log("workspace deps resolved for publish");
