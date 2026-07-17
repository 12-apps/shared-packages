#!/usr/bin/env node
/**
 * Portable test supervisor: guarantees no vitest worker outlives its run.
 *
 * Runs `vitest <args>` as a child in ITS OWN process group. When this supervisor
 * is told to stop — any catchable signal (SIGINT/SIGTERM/SIGHUP, i.e. Ctrl-C, a
 * killed launcher, or a torn-down tmux pane), or the child simply exiting — it
 * SIGKILLs the entire process group. A kernel SIGKILL reaps even a worker whose
 * event loop is wedged in jsdom under memory pressure (the real orphan case that
 * no in-process handler can fix), so nothing reparents to init and leaks RAM.
 *
 * Portable: pure Node + process groups (POSIX) / taskkill tree (Windows).
 * Automatic: wire it as the package `test` script so every run is supervised.
 * Isolation-preserving: does not touch the pool — keep `pool: forks`.
 *
 * Residual: a direct `kill -9` of THIS supervisor is uncatchable and cannot be
 * covered in userspace on every OS; that rare case is the only gap.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const isWin = process.platform === "win32";

// Resolve vitest's CLI entry via its package.json "bin" — the public, supported
// contract — instead of probing internal dist paths that shift between versions.
// `vitest/package.json` is always resolvable; `bin` (string or {vitest}) points
// at the CLI. Run it under THIS node so we keep our own process group and don't
// depend on vitest being on PATH. Falls back to `npx vitest` if resolution fails
// (the fallback is still group-correct: with detached:true the spawned process
// is a group leader and every descendant — npx, vitest, forked workers — shares
// that pgid, so killGroup reaches them all).
let entry;
try {
  const pkgPath = require.resolve("vitest/package.json");
  const { bin } = JSON.parse(readFileSync(pkgPath, "utf8"));
  const rel = typeof bin === "string" ? bin : bin?.vitest;
  if (rel) entry = path.resolve(path.dirname(pkgPath), rel);
} catch {
  /* fall through to npx */
}
const child = entry
  ? spawn(process.execPath, [entry, ...process.argv.slice(2)], {
      stdio: "inherit",
      detached: !isWin, // own process group on POSIX so we can signal the whole tree
    })
  : spawn(isWin ? "npx.cmd" : "npx", ["vitest", ...process.argv.slice(2)], {
      stdio: "inherit",
      detached: !isWin,
      shell: isWin,
    });

let tearingDown = false;
function killGroup(signal) {
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, signal); // negative pid => whole process group
    }
  } catch {
    /* group already gone */
  }
}
function teardown() {
  if (tearingDown) return;
  tearingDown = true;
  killGroup("SIGTERM"); // let vitest reap gracefully if it still can...
  setTimeout(() => killGroup("SIGKILL"), 2_000).unref(); // ...then force, wedged or not
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
  process.on(sig, teardown); // do NOT exit here; child.on('exit') drives our exit
}

child.on("exit", (code, signal) => {
  killGroup("SIGKILL"); // sweep any straggler workers from a normal finish too
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (err) => {
  console.error("[vitest-with-teardown] failed to spawn vitest:", err.message);
  process.exit(1);
});
