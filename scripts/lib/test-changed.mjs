// Pure parts of scripts/test-changed.mjs (FUT-4348): argument parsing and the
// mapping of changed files to the workspace that owns them. No I/O here, so the
// selftest can drive it with plain data.
import path from "node:path";

export const USAGE = `Usage: pnpm test:changed [--uncommitted] [--help]

Runs only the unit tests the change reaches: for each workspace with changed
source files, \`vitest related --run <those files>\` from that workspace.

  (default)       files changed since merge-base(origin/main, HEAD), in the
                  working tree, plus untracked files
  --uncommitted   files changed since HEAD (working tree + untracked) only
  --help, -h      show this text

A workspace without vitest is reported and skipped; its own test script is
never run. Files outside any workspace are listed as not unit-tested here.
Exit code: 0 all green, 1 a run failed, 2 bad usage.`;

/** @returns {{ok: true, help: boolean, uncommitted: boolean} | {ok: false, error: string}} */
export function parseArgs(argv) {
  const result = { ok: true, help: false, uncommitted: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--uncommitted") result.uncommitted = true;
    else return { ok: false, error: `unknown argument: ${arg}` };
  }
  return result;
}

/** Reads the `packages:` globs (`a/*`, `a/b/*`, `a/c`) out of pnpm-workspace.yaml. */
export function parseWorkspaceGlobs(yamlText) {
  const globs = [];
  let inPackages = false;
  for (const line of yamlText.split("\n")) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s+-\s+["']?([^"'#\s]+)["']?/);
    if (item) globs.push(item[1]);
    else if (/^\S/.test(line)) inPackages = false;
  }
  return globs;
}

export function globToRegExp(glob) {
  const source = glob
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => (segment === "*" ? "[^/]+" : segment.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}$`);
}

/** Whether a directory (repo-relative, posix) is a workspace root per the globs. */
export function isWorkspaceDir(dir, globs) {
  return globs.some((glob) => globToRegExp(glob).test(dir));
}

/**
 * Maps a repo-relative file to its NEAREST ancestor directory that is a
 * workspace and has a package.json (`hasPackageJson(dir) => boolean`).
 * Returns the directory, or null when no workspace owns the file.
 */
export function workspaceOf(file, globs, hasPackageJson) {
  let dir = path.posix.dirname(file);
  while (dir && dir !== ".") {
    if (isWorkspaceDir(dir, globs) && hasPackageJson(dir)) return dir;
    dir = path.posix.dirname(dir);
  }
  return null;
}

/** Splits files into `{byWorkspace: Map<dir, string[]>, outside: string[]}`. */
export function groupByWorkspace(files, globs, hasPackageJson) {
  const byWorkspace = new Map();
  const outside = [];
  for (const file of [...new Set(files)].sort()) {
    const dir = workspaceOf(file, globs, hasPackageJson);
    if (dir === null) outside.push(file);
    else byWorkspace.set(dir, [...(byWorkspace.get(dir) ?? []), file]);
  }
  return { byWorkspace, outside };
}

/** Files of a workspace as vitest wants them: relative to the workspace root. */
export function relativeToWorkspace(dir, files) {
  return files.map((file) => path.posix.relative(dir, file));
}
