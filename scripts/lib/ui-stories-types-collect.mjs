// The COLLECTING half of the ui-stories-types gate (FUT-2699): runs the
// package's own `tsc` over `tsconfig.stories.json` and turns its output into
// one error count per file. `scanSource`-style in-process programs (see
// `ui-tokens-collect.mjs`) were considered and dropped here on purpose: a
// story pulls in the WHOLE component tree through ordinary imports, so
// reproducing that resolution by hand would just re-implement `tsc -p`. The
// real compiler, on the real project file, is the measure the ticket itself
// used (FUT-2699's "Run with the package's own tsc").
import { spawnSync } from "node:child_process";

export const TSCONFIG = "packages/ui/tsconfig.stories.json";

// tsc --pretty false: `path(line,col): error TSxxxx: message`, one line per
// error, with the message continuing on indented lines that this does not
// match. `path` is repo-relative because we invoke tsc from the repo root.
const ERROR_LINE = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+): ?(.*)$/;

/**
 * Run `tsc -p packages/ui/tsconfig.stories.json` from `repoRoot`. Returns the
 * combined stdout/stderr text — `parseErrors` below is what turns it into
 * findings, so this stays a thin, mockable seam for the selftest.
 */
export function runTsc(repoRoot = process.cwd()) {
  const result = spawnSync("pnpm", ["exec", "tsc", "-p", TSCONFIG, "--pretty", "false"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`could not run tsc: ${result.error.message}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * `file` -> error count, and `file` -> its first few messages (for the
 * "unlisted" failure text), plus any error whose "file" is not a story — a
 * config-level error (a bad `tsconfig.stories.json`, a missing project) reads
 * as one file failing loudly rather than as a normal finding.
 */
export function parseErrors(output) {
  const counts = new Map();
  const detail = new Map();
  const configErrors = [];
  for (const line of output.split("\n")) {
    const m = ERROR_LINE.exec(line);
    if (!m) continue;
    const [, file, lineNo, , code, message] = m;
    if (!file.endsWith(".stories.tsx")) {
      configErrors.push(line);
      continue;
    }
    counts.set(file, (counts.get(file) ?? 0) + 1);
    const list = detail.get(file) ?? [];
    if (list.length < 5) list.push(`${file}:${lineNo} ${code}${message ? `: ${message}` : ""}`);
    detail.set(file, list);
  }
  return { counts, detail, configErrors };
}

/** Run tsc and parse it in one call — what the gate and `--update` both want. */
export function collectFindings(repoRoot = process.cwd()) {
  return parseErrors(runTsc(repoRoot));
}
