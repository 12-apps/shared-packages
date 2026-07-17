// Rewrite `workspace:*` (and workspace:^ / workspace:~) interdependencies to the
// concrete sibling versions before `npm publish` — npm, unlike pnpm, does not
// understand the workspace protocol, so a published manifest must carry real
// version ranges. Run AFTER semantic-release has set each package.json version.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PKGS = new URL("../packages/", import.meta.url).pathname;
const MF = "package.json";

// name -> current version, across every workspace package.
const versions = new Map();
for (const dir of readdirSync(PKGS)) {
  const mf = join(PKGS, dir, MF);
  if (!existsSync(mf)) continue;
  const pkg = JSON.parse(readFileSync(mf, "utf8"));
  versions.set(pkg.name, pkg.version);
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const WS = /^workspace:(.*)$/;

for (const dir of readdirSync(PKGS)) {
  const mf = join(PKGS, dir, MF);
  if (!existsSync(mf)) continue;
  const pkg = JSON.parse(readFileSync(mf, "utf8"));
  let changed = false;
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      const m = WS.exec(range);
      if (!m) continue;
      const v = versions.get(name);
      if (!v) throw new Error(`${pkg.name}: ${field}.${name} is workspace but ${name} has no version`);
      // workspace:* / workspace:^ / workspace:~ -> ^v ; workspace:<range> -> <range>
      const spec = m[1] === "" || m[1] === "*" || m[1] === "^" ? `^${v}` : m[1] === "~" ? `~${v}` : m[1];
      deps[name] = spec;
      changed = true;
      console.log(`${pkg.name}: ${field}.${name} ${range} -> ${spec}`);
    }
  }
  if (changed) writeFileSync(mf, JSON.stringify(pkg, null, 2) + "\n");
}
console.log("workspace deps resolved for publish");
