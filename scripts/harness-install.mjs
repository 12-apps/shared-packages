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

/**
 * Install, retrying a STALE PACKUMENT — the one npm failure here that is not
 * about our code and does not stay failed.
 *
 * The harness deliberately has no lockfile (it must resolve like a fresh
 * consumer), so every run asks the registry for the newest thing satisfying
 * each range. That is the point, and it is also the exposure: the AWS SDK
 * publishes ~100 sibling packages per release, and while a wave is in flight
 * npm's CDN can serve a packument that lists a client version whose sibling is
 * not visible yet. npm reports that as `ETARGET … No matching version found`,
 * which reads exactly like a dependency we got wrong.
 *
 * It is not. Measured on #185: two consecutive runs failed on two DIFFERENT
 * siblings (`@aws-sdk/core@^3.977.8`, then
 * `@aws-sdk/credential-provider-ini@^3.973.14`), and both versions were live on
 * the registry — `npm view` listed them while `npm install` denied them. The
 * install path reads the ABBREVIATED packument and npm caches it, so once a
 * stale copy is cached the retry fails identically for as long as the cache
 * entry lives.
 *
 * Hence `--prefer-online` from the second attempt: it revalidates rather than
 * trusting the cached packument, which is precisely the thing that was wrong.
 * A plain retry would not have fixed it, and pinning would not either — the
 * lockfile's own `@aws-sdk/client-s3` pin reproduced the failure.
 *
 * A genuinely bad range still fails, just three attempts later.
 */
const INSTALL_ATTEMPTS = 3;

function npmInstall(dir) {
  const base = ["install", "--no-audit", "--no-fund", "--loglevel=error"];
  for (let attempt = 1; ; attempt += 1) {
    try {
      run("npm", attempt === 1 ? base : [...base, "--prefer-online"], dir);
      return;
    } catch (error) {
      if (attempt === INSTALL_ATTEMPTS) throw error;
      // Seconds, not milliseconds: a CDN edge that just served a stale
      // packument needs long enough to pick the new one up, and this whole
      // lane already costs minutes.
      const waitSeconds = attempt * 15;
      console.log(
        `npm install failed in ${dir} (attempt ${attempt}/${INSTALL_ATTEMPTS}); ` +
          `retrying in ${waitSeconds}s with --prefer-online`,
      );
      // Blocking by design — this script is a linear build step, and sleeping
      // on the main thread is what keeps it one. `Atomics.wait` rather than a
      // `sleep` child process so it needs no binary on the runner.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitSeconds * 1000);
    }
  }
}

/**
 * Assemble the schema and GENERATE the client, for a harness that has one.
 *
 * Part of the INSTALL rather than of a test script, and the reason is the lane
 * that found it: `harness/backend`'s `pretest` used to be the only caller, so
 * the client existed whenever its own suite ran and nowhere else — and the
 * moment the server itself imported `@prisma/client` (the payments adoption,
 * whose stores are the package's own Prisma ones), every OTHER lane that boots
 * that server died at import with `MODULE_NOT_FOUND`, minutes into a run, in a
 * job whose name says Gherkin.
 *
 * An adopter's install includes `prisma generate` too. Doing it here makes the
 * installed harness usable by whoever starts it, which is the property a
 * `pretest` hook cannot give.
 */
function generatePrisma(harness, dir) {
  const scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts ?? {};
  if (!scripts["prisma:generate"]) return;
  run("npm", ["run", "prisma:generate"], dir);
  console.log(`generated the prisma client for ${harness}`);
}

function install(harness, tarballs) {
  const dir = join(REPO_ROOT, harness);
  if (!existsSync(join(dir, "package.base.json"))) throw new Error(`${harness} has no package.base.json`);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifestFor(dir, tarballs), null, 2)}\n`);
  npmInstall(dir);
  console.log(`installed ${harness} against ${tarballs.size} tarballs`);
  generatePrisma(harness, dir);
}

const staging = mkdtempSync(join(tmpdir(), "harness-tarballs-"));
const tarballs = packAll(publishableDirs(), staging);
HARNESSES.forEach((harness) => install(harness, tarballs));
