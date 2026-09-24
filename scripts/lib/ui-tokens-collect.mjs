// The COLLECTING half of the ui-tokens scanner (FUT-2585): which files are in
// scope, one type-checked program over them, and every finding counted per
// `file — rule`. What counts as a finding is `./ui-tokens-scan.mjs`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import { scanSource } from "./ui-tokens-scan.mjs";

const UI_SRC = "packages/ui/src";
const ROOTS = ["components", "button", "user-avatar", "social-login-button", "icons"];
/** Tests, stories, the native renderer and the one unexported worked example are not shipped web styling. */
const OUT_OF_SCOPE = /(__tests__|\.test\.|\.spec\.|\.stories\.|\.native\.|\.example\.)/;

/** The files in scope, repo-relative, sorted. */
export function scopeFiles(repoRoot = process.cwd()) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !OUT_OF_SCOPE.test(full)) files.push(relative(repoRoot, full));
    }
  };
  for (const root of ROOTS) walk(join(repoRoot, UI_SRC, root));
  return files.sort();
}

/**
 * One program over the scope, with every import resolved — MUI's and React's
 * included. Resolving only relative imports was tried (3s instead of ~15s) and
 * undone: with MUI unresolved a `styled()` callback's props and a component's
 * props type as `any`, and `minWidth: CIRCLE_SIZE[size]` went unreported.
 */
function createScopeProgram(files) {
  return ts.createProgram(files, {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, types: [], strict: true,
    noUncheckedIndexedAccess: true, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true,
  });
}

/** `file — rule` -> count, and the lines behind each, over the whole scope. */
export function collectFindings(repoRoot = process.cwd()) {
  const counts = new Map();
  const detail = new Map();
  const files = scopeFiles(repoRoot);
  const program = createScopeProgram(files.map((f) => join(repoRoot, f)));
  const checker = program.getTypeChecker();
  const all = files.flatMap((file) => {
    const full = join(repoRoot, file);
    return scanSource(file, readFileSync(full, "utf8"), checker, program.getSourceFile(full)).map((f) => ({ file, ...f }));
  });
  for (const f of all) {
    const key = `${f.file} — ${f.rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    detail.set(key, [...(detail.get(key) ?? []), `${f.file}:${f.line} ${f.snippet}`]);
  }
  return { counts, detail };
}
