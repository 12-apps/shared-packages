// Install the harness apps against the PUBLISHED tarballs.
//
// The harness lives outside pnpm-workspace.yaml's globs on purpose, so nothing
// here is linked back to `packages/`. What it consumes is what npm would
// upload, which is the only version of these packages a consumer ever sees.
//
// `package.json` is GENERATED from `package.base.json` and gitignored: the
// @12-apps dependencies are file: paths to tarballs whose names carry the
// version, so a committed manifest would either pin a version nobody remembers
// to bump or drift from the tarballs on every release.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packAll, publishableDirs } from "./lib/pack-workspace.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESSES = ["harness/frontend", "harness/backend"];

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

/**
 * `overrides` as well as `dependencies`, for the same reason the Layer 1
 * fixture needs it: payments-frontend depends on payments-backend, and without
 * an override npm resolves that to the PUBLISHED version — so the harness would
 * quietly test last week's backend against this branch's frontend.
 */
function manifestFor(harness, tarballs) {
  const base = JSON.parse(readFileSync(join(harness, "package.base.json"), "utf8"));
  const specs = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]));
  return { ...base, dependencies: specs, overrides: specs };
}

function install(harness, tarballs) {
  const dir = join(REPO_ROOT, harness);
  if (!existsSync(join(dir, "package.base.json"))) throw new Error(`${harness} has no package.base.json`);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifestFor(dir, tarballs), null, 2)}\n`);
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  console.log(`installed ${harness} against ${tarballs.size} tarballs`);
}

const staging = mkdtempSync(join(tmpdir(), "harness-tarballs-"));
const tarballs = packAll(publishableDirs(), staging);
HARNESSES.forEach((harness) => install(harness, tarballs));
