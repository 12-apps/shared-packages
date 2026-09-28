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
// list with this project's own six breakpoints (`xxs`…`xxl`), so a story naming
// one of Storybook's stock device keys (`mobile1`, `iphone6`, …) would not have
// resolved even before SB9 dropped the parameter — those keys were never in
// `preview.tsx`'s own list either.
//
// FUT-2778 migrated the first three occurrences (`SettingsLayout.stories.tsx`)
// by hand. FUT-2864 migrated the other 77 files this gate was written to
// guard: there is no valid use of `defaultViewport` left to grandfather, so
// this gate carries NO LEDGER — like `host-brand-gate.mjs`, every finding is
// new debt, from the day this gate lands.
//
// ## WHAT IS FLAGGED, per `*.stories.tsx` / `*.test.stories.tsx` under
// `packages/ui/src`:
//
//   1. Any `defaultViewport` property inside a `viewport` parameters object —
//      unconditionally dead, regardless of what it names.
//   2. Any `globals: { viewport: { value: 'X' } }` whose `X` is not one of
//      `preview.tsx`'s own six keys AND not a key defined by a per-file
//      `parameters.viewport.options` override in the SAME FILE (the pattern
//      `AppHeader.stories.tsx` and `Form.stories.tsx` use for a device the
//      project's six don't stand in for) — a selection that resolves to
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
import { pathToFileURL } from "node:url";

import ts from "typescript";

const LABEL = "[viewport-key]";
export const PREVIEW_PATH = "packages/ui/.storybook/preview.tsx";
const SCOPE = /^packages\/ui\/src\/.*\.stories\.tsx$/;

const findProp = (obj, name) =>
  obj.properties.find(
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The keys `.storybook/preview.tsx` actually defines under `viewport.options`. */
export function readPreviewKeys(text, file = PREVIEW_PATH) {
  const sf = parse(file, text);
  const keys = new Set();
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const viewport = findProp(node, "viewport");
      if (viewport && ts.isObjectLiteralExpression(viewport.initializer)) {
        const options = findProp(viewport.initializer, "options");
        if (options && ts.isObjectLiteralExpression(options.initializer)) {
          for (const p of options.initializer.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) keys.add(p.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

/**
 * Every `defaultViewport` occurrence and every `globals.viewport.value`
 * occurrence in one file, each as `{ line, kind, value }`.
 */
export function collectOccurrences(file, text) {
  const sf = parse(file, text);
  const found = [];

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      // `parameters.viewport.options` (or the legacy `viewports` spelling,
      // which this gate also flags as unmigrated — see rule 1's sibling case
      // below) — collected as this file's locally-declared keys.
      const viewport = findProp(node, "viewport");
      if (viewport && ts.isObjectLiteralExpression(viewport.initializer)) {
        const dv = findProp(viewport.initializer, "defaultViewport");
        if (dv) {
          found.push({
            line: sf.getLineAndCharacterOfPosition(dv.getStart()).line + 1,
            kind: "defaultViewport",
            value: ts.isStringLiteral(dv.initializer) ? dv.initializer.text : "<non-string>",
          });
        }
      }
      // `globals.viewport.value`
      const globalsProp = findProp(node, "globals");
      if (globalsProp && ts.isObjectLiteralExpression(globalsProp.initializer)) {
        const gv = findProp(globalsProp.initializer, "viewport");
        if (gv && ts.isObjectLiteralExpression(gv.initializer)) {
          const value = findProp(gv.initializer, "value");
          if (value && ts.isStringLiteral(value.initializer)) {
            found.push({
              line: sf.getLineAndCharacterOfPosition(value.getStart()).line + 1,
              kind: "globals.value",
              value: value.initializer.text,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** Every key any `parameters.viewport.options` (or unmigrated `viewports`) object in the file declares. */
export function collectLocalOptionKeys(file, text) {
  const sf = parse(file, text);
  const keys = new Set();
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const viewport = findProp(node, "viewport");
      if (viewport && ts.isObjectLiteralExpression(viewport.initializer)) {
        for (const name of ["options", "viewports"]) {
          const opt = findProp(viewport.initializer, name);
          if (opt && ts.isObjectLiteralExpression(opt.initializer)) {
            for (const p of opt.initializer.properties) {
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) keys.add(p.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

/** Findings for one file, as `path:line — reason` strings. */
export function findingsFor(file, text, previewKeys) {
  const occurrences = collectOccurrences(file, text);
  if (occurrences.length === 0) return [];
  const localKeys = collectLocalOptionKeys(file, text);
  const findings = [];
  for (const o of occurrences) {
    if (o.kind === "defaultViewport") {
      findings.push(
        `${file}:${o.line} — parameters.viewport.defaultViewport: '${o.value}' is dead in this ` +
          `Storybook (SB9 reads globals.viewport.value, not this parameter) — select the viewport with ` +
          `\`globals: { viewport: { value: '${o.value}' } }\` instead.`,
      );
    } else if (o.kind === "globals.value") {
      if (!previewKeys.has(o.value) && !localKeys.has(o.value)) {
        findings.push(
          `${file}:${o.line} — globals.viewport.value: '${o.value}' names no viewport: not one of ` +
            `preview.tsx's options (${[...previewKeys].sort().join(", ")}) and no local ` +
            `parameters.viewport.options in this file defines it.`,
        );
      }
    }
  }
  return findings;
}

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function trackedStoryFiles() {
  return git(["ls-files", "packages/ui/src"])
    .split("\n")
    .filter((f) => SCOPE.test(f));
}

export function sweep() {
  const previewKeys = readPreviewKeys(readFileSync(PREVIEW_PATH, "utf8"));
  const findings = [];
  for (const file of trackedStoryFiles()) {
    const text = readFileSync(file, "utf8");
    findings.push(...findingsFor(file, text, previewKeys));
  }
  return findings;
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
