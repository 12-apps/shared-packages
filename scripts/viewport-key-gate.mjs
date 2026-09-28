// The viewport-key gate: `parameters.viewport.defaultViewport` is dead in this
// Storybook (FUT-2864), and a viewport `globals` selection must name a key
// that actually resolves to a size.
//
// ## Why
//
// Storybook 9 moved viewport SELECTION from `parameters.viewport.defaultViewport`
// to `globals.viewport.value`. The old key is still a valid TypeScript shape —
// `defaultViewport` remains a legal field on `parameters.viewport` — but nothing
// in `storybook@9.1.20` reads it, so a story naming one renders at whatever
// viewport the toolbar already had selected, never the one it names, silently.
// `.storybook/preview.tsx` also replaces the viewport addon's entire options
// list with this project's own seven breakpoints (`xxs`…`xxl`), so a story
// naming one of Storybook's stock device keys (`mobile1`, `iphone6`, …) would
// not have resolved even before SB9 dropped the parameter — those keys were
// never in `preview.tsx`'s own list either.
//
// FUT-2778 migrated the first three occurrences (`SettingsLayout.stories.tsx`)
// by hand. FUT-2864 migrated the other 77 files this gate was written to
// guard: there is no valid use of `defaultViewport` left to grandfather, so
// this gate carries NO LEDGER — like `host-brand-gate.mjs`, every finding is
// new debt, from the day this gate lands.
//
// ## SCOPE — derived from `.storybook/main.ts`, not hand-copied
//
// This Storybook's `stories` globs name TWO roots rendered through the same
// `preview.tsx` — `packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)` and
// `packages/product-research-ui/src/**/*.stories.@(ts|tsx)` (FUT-420) — and a
// gate hand-coded to only the first would let a story under the second dodge
// it invisibly. `readStoryGlobs`/`storyFileMatchers` read `main.ts`'s own
// `stories` array and compile each glob to a matcher, so a THIRD root added to
// that array is covered here with no edit to this file at all.
//
// ## WHAT IS FLAGGED, per story file `main.ts` itself would load:
//
//   1. Any `defaultViewport` property inside a `viewport` parameters object —
//      unconditionally dead, regardless of what it names.
//   2. Any `globals: { viewport: { value: 'X' } }` whose `X` is not one of
//      `preview.tsx`'s own seven keys AND not a key defined by a per-file
//      `parameters.viewport.options` override in the SAME FILE (the pattern
//      `AppHeader.stories.tsx` and `Form.stories.tsx` use for a device the
//      project's seven don't stand in for) — a selection that resolves to
//      nothing is exactly as silent a no-op as `defaultViewport` was.
//
// A file that defines its own `options` is read permissively (its keys are
// legal for any story IN THAT FILE, not just the story that declares the
// override) — Storybook itself resolves `globals.viewport.value` against
// whatever `parameters.viewport.options` a story's own parameters carry after
// inheriting the meta's, so a per-file gate that scoped narrower than that
// would refuse legitimate meta-level overrides.
//
// ## Usage
//
//   node scripts/viewport-key-selftest.mjs && node scripts/viewport-key-gate.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix as posixPath } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const LABEL = "[viewport-key]";
export const PREVIEW_PATH = "packages/ui/.storybook/preview.tsx";
export const MAIN_PATH = "packages/ui/.storybook/main.ts";

const findProp = (obj, name) =>
  obj.properties.find(
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Walks `obj.<name1>.<name2>…` through nested object-literal properties,
 * returning the innermost object literal — or `null` the moment a link is
 * missing or isn't itself an object literal. Every AST chain this gate reads
 * (`viewport.options`, `viewport.defaultViewport`'s parent, `globals.viewport`,
 * …) is exactly this shape, so one small, flat helper replaces a fresh
 * pyramid of nested `if`s at every call site.
 */
function getNestedObject(node, ...names) {
  let current = node;
  for (const name of names) {
    if (!ts.isObjectLiteralExpression(current)) return null;
    const prop = findProp(current, name);
    if (!prop || !ts.isObjectLiteralExpression(prop.initializer)) return null;
    current = prop.initializer;
  }
  return current;
}

/** Every property NAME on an object literal, added into `set`. */
function addPropertyNames(set, objectLiteral) {
  for (const p of objectLiteral.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) set.add(p.name.text);
  }
}

/** The keys `.storybook/preview.tsx` actually defines under `viewport.options`. */
export function readPreviewKeys(text, file = PREVIEW_PATH) {
  const sf = parse(file, text);
  const keys = new Set();
  function visit(node) {
    const options = getNestedObject(node, "viewport", "options");
    if (options) addPropertyNames(keys, options);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

/** A `parameters.viewport.defaultViewport` finding at this node, or `null`. */
function defaultViewportFinding(sf, node) {
  const viewport = getNestedObject(node, "viewport");
  if (!viewport) return null;
  const dv = findProp(viewport, "defaultViewport");
  if (!dv) return null;
  return {
    line: sf.getLineAndCharacterOfPosition(dv.getStart()).line + 1,
    kind: "defaultViewport",
    value: ts.isStringLiteral(dv.initializer) ? dv.initializer.text : "<non-string>",
  };
}

/** A `globals.viewport.value` finding at this node, or `null`. */
function globalsValueFinding(sf, node) {
  const gv = getNestedObject(node, "globals", "viewport");
  if (!gv) return null;
  const value = findProp(gv, "value");
  if (!value || !ts.isStringLiteral(value.initializer)) return null;
  return {
    line: sf.getLineAndCharacterOfPosition(value.getStart()).line + 1,
    kind: "globals.value",
    value: value.initializer.text,
  };
}

/**
 * Every `defaultViewport` occurrence and every `globals.viewport.value`
 * occurrence in one file, each as `{ line, kind, value }`.
 */
export function collectOccurrences(file, text) {
  const sf = parse(file, text);
  const found = [];
  function visit(node) {
    const dv = defaultViewportFinding(sf, node);
    if (dv) found.push(dv);
    const gv = globalsValueFinding(sf, node);
    if (gv) found.push(gv);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** The raw `stories` glob strings `.storybook/main.ts` itself declares. */
export function readStoryGlobs(mainText, file = MAIN_PATH) {
  const sf = ts.createSourceFile(file, mainText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let globs = [];
  function isStoriesArray(node) {
    return (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "stories" &&
      ts.isArrayLiteralExpression(node.initializer)
    );
  }
  function visit(node) {
    if (isStoriesArray(node)) {
      globs = node.initializer.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return globs;
}

/** The literal directory a resolved glob starts with, before its first wildcard. */
function literalRootOf(resolvedGlob) {
  const wildcard = resolvedGlob.search(/[*?@{]/);
  const prefix = wildcard === -1 ? resolvedGlob : resolvedGlob.slice(0, wildcard);
  const lastSlash = prefix.lastIndexOf("/");
  return lastSlash === -1 ? "" : prefix.slice(0, lastSlash);
}

// One glob "unit" at a time: '**/' and '**' before the plain '*' they'd
// otherwise be swallowed by, `@(a|b)` (extglob alternation) as its own unit so
// the pipes and parens inside it are never re-escaped by the catch-all, then
// '?' and the single characters a `RegExp` source needs escaped.
const GLOB_TOKEN = /(\*\*\/|\*\*|\*|\?|@\([^)]*\)|[.+^${}()|[\]\\])/g;

/** One glob token (as `GLOB_TOKEN` matched it) translated to its regex source. */
function translateGlobToken(token) {
  if (token === "**/") return "(?:.*/)?";
  if (token === "**") return ".*";
  if (token === "*") return "[^/]*";
  if (token === "?") return "[^/]";
  if (token.startsWith("@(")) return `(?:${token.slice(2, -1)})`;
  return `\\${token}`; // a lone regex metacharacter, escaped
}

/**
 * A `main.ts` glob (relative to `.storybook/`) compiled to a matcher against
 * a repo-root-relative path, plus the literal directory prefix it starts
 * with — the pathspec `git ls-files` is scoped to, so a huge unrelated tree
 * is never walked just to throw its files away.
 */
function compileGlob(rawGlob) {
  const resolved = posixPath.normalize(posixPath.join(posixPath.dirname(MAIN_PATH), rawGlob));
  const root = literalRootOf(resolved);
  const pattern = resolved.replace(GLOB_TOKEN, translateGlobToken);
  return { root, regex: new RegExp(`^${pattern}$`) };
}

/** Every glob `main.ts` declares, compiled — the gate's actual scan scope. */
export function storyFileMatchers(mainText) {
  return readStoryGlobs(mainText).map(compileGlob);
}

/** Every key any `parameters.viewport.options` (or unmigrated `viewports`) object in the file declares. */
export function collectLocalOptionKeys(file, text) {
  const sf = parse(file, text);
  const keys = new Set();
  function visit(node) {
    for (const name of ["options", "viewports"]) {
      const obj = getNestedObject(node, "viewport", name);
      if (obj) addPropertyNames(keys, obj);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

/** One occurrence's finding string, or `null` if it names a real viewport. */
function findingFor(o, file, previewKeys, localKeys) {
  if (o.kind === "defaultViewport") {
    return (
      `${file}:${o.line} — parameters.viewport.defaultViewport: '${o.value}' is dead in this ` +
      `Storybook (SB9 reads globals.viewport.value, not this parameter) — select the viewport with ` +
      `\`globals: { viewport: { value: '${o.value}' } }\` instead.`
    );
  }
  if (previewKeys.has(o.value) || localKeys.has(o.value)) return null;
  return (
    `${file}:${o.line} — globals.viewport.value: '${o.value}' names no viewport: not one of ` +
    `preview.tsx's options (${[...previewKeys].sort().join(", ")}) and no local ` +
    `parameters.viewport.options in this file defines it.`
  );
}

/** Findings for one file, as `path:line — reason` strings. */
export function findingsFor(file, text, previewKeys) {
  const occurrences = collectOccurrences(file, text);
  if (occurrences.length === 0) return [];
  const localKeys = collectLocalOptionKeys(file, text);
  return occurrences
    .map((o) => findingFor(o, file, previewKeys, localKeys))
    .filter((finding) => finding !== null);
}

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Every tracked file matching one glob matcher. */
function filesFor({ root, regex }) {
  const tracked = root ? git(["ls-files", "--", root]) : git(["ls-files"]);
  return tracked.split("\n").filter((f) => f && regex.test(f));
}

function trackedStoryFiles(matchers) {
  return [...new Set(matchers.flatMap(filesFor))];
}

export function sweep() {
  const previewKeys = readPreviewKeys(readFileSync(PREVIEW_PATH, "utf8"));
  const matchers = storyFileMatchers(readFileSync(MAIN_PATH, "utf8"));
  return trackedStoryFiles(matchers).flatMap((file) =>
    findingsFor(file, readFileSync(file, "utf8"), previewKeys),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = sweep();
  if (findings.length > 0) {
    console.error(`${LABEL} ${findings.length} finding(s) — no ledger, all of this shape is new debt:\n`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL} clean — no dead defaultViewport parameter and every globals.viewport.value resolves.`);
}
