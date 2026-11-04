// The local test command (FUT-4348): run only the unit tests the change
// reaches. The root "test" script is this; "test:all" (turbo run test) is the
// whole suite and is CI's job, not an agent's. Pure parts: lib/test-changed.mjs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  USAGE,
  groupByWorkspace,
  parseArgs,
  parseWorkspaceGlobs,
  relativeToWorkspace,
} from "./lib/test-changed.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(`${args.error}\n\n${USAGE}`);
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const lines = (text) => text.split("\n").filter(Boolean);

const base = args.uncommitted ? "HEAD" : git("merge-base", "origin/main", "HEAD").trim();
const files = [
  ...new Set([
    ...lines(git("diff", "--name-only", "--diff-filter=d", base)),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ]),
];

const globs = parseWorkspaceGlobs(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"));
const hasPackageJson = (dir) => existsSync(path.join(root, dir, "package.json"));
const hasVitest = (dir) =>
  ["ts", "mts", "js", "mjs"].some((ext) => existsSync(path.join(root, dir, `vitest.config.${ext}`)));
const { byWorkspace, outside } = groupByWorkspace(files, globs, hasPackageJson);

const since = args.uncommitted ? "HEAD" : `merge-base ${base.slice(0, 9)}`;
console.log(`test:changed: ${files.length} file(s) changed since ${since}`);

let failed = 0;
for (const [dir, wsFiles] of byWorkspace) {
  if (!hasVitest(dir)) {
    console.log(
      `\n[${dir}] no vitest config: skipped (${wsFiles.length} file(s) changed; its test script is never run here)`,
    );
    continue;
  }
  console.log(`\n[${dir}] vitest related --run (${wsFiles.length} file(s))`);
  const run = spawnSync(
    "npx",
    ["vitest", "related", "--run", "--passWithNoTests", ...relativeToWorkspace(dir, wsFiles)],
    {
      cwd: path.join(root, dir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 << 20,
    },
  );
  const out = `${run.stdout}${run.stderr}`;
  if (run.status === 0) {
    const summary = out.split("\n").filter((l) => /^\s*(Test Files|Tests|Duration)\b/.test(l));
    console.log(summary.length ? summary.join("\n") : "passed (no summary printed)");
  } else {
    failed += 1;
    console.log(out);
    console.log(`[${dir}] FAILED (exit ${run.status})`);
  }
}

if (outside.length) {
  console.log(`\nNot unit-tested here (outside any workspace): ${outside.length} file(s)`);
  for (const file of outside) console.log(`  ${file}`);
}
if (byWorkspace.size === 0) console.log("\nNo workspace files changed: nothing to run.");
console.log(failed ? `\ntest:changed: ${failed} workspace run(s) FAILED` : "\ntest:changed: ok");
process.exit(failed ? 1 : 0);
