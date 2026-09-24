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
 * One program over the scope, resolving RELATIVE imports only — that is where
 * the metrics tables are. A bare import (`react`, `@mui/*`) stays unresolved,
 * its values type as `any`, and `any` is never reported: skipping node_modules
 * can only under-report, and it is most of the cost.
 */
function createScopeProgram(files) {
  const options = {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, types: [], strict: true, noUncheckedIndexedAccess: true,
  };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNameLiterals = (literals, containingFile) => literals.map((lit) =>
    (lit.text.startsWith(".") ? ts.resolveModuleName(lit.text, containingFile, options, host) : { resolvedModule: undefined }));
  return ts.createProgram(files, options, host);
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
