// One reading of "what entry points does this manifest promise a consumer", for
// the two gates that both need to ask.
//
// `scripts/verify-package-consumers.mjs` asks it of a throwaway fixture it
// installs itself; `harness/backend/tests/published-subpaths.test.ts` asks it of
// the harness's own installed tree. They are different lanes on purpose — one
// packs and installs, the other is a real app that already has the tarballs —
// but a subpath is a subpath, and two readings of `exports` would eventually
// disagree about which one exists. A wildcard is where they would diverge
// first, and a divergence there is silent in the direction that matters: the
// gate that expands fewer entries simply asserts less.
//
// So the expansion lives here once, and both callers import it.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Files that carry no information about whether a package is usable. */
const BOILERPLATE = /^(?:package\.json|README|LICEN[CS]E|CHANGELOG)/i;

/**
 * The resolution fields that predate `exports`, and that `exports` does not
 * cover.
 *
 * Node and every modern bundler prefer `exports`, so these look decorative —
 * but they are still what a classic-resolution `tsc` (`moduleResolution: Node`)
 * and older bundlers read, and nothing else in this repo looks at them at all.
 * `@12-apps/ui` carried `module: ./dist/index.mjs` for as long as it has been
 * dual-format, naming a file tsup has never emitted, and no check anywhere had
 * an opinion.
 *
 * `browser` is included only in its string form: the object form is a
 * substitution map, not an entry point.
 */
const LEGACY_FIELDS = ["main", "module", "browser", "types", "typings"];

/** Every file inside an installed package, as package-relative paths. */
export function shippedFiles(pkgDir) {
  return readdirSync(pkgDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(pkgDir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.startsWith("node_modules/"));
}

/** The files that say something about whether the package is usable at all. */
export function meaningfulFiles(files) {
  return files.filter((file) => !BOILERPLATE.test(file));
}

/** Every target an exports value points at, across all its conditions. */
function targetsOf(value) {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(targetsOf);
}

/** Normalise the two shapes `exports` can take into subpath -> value pairs. */
function exportPairs(exports) {
  if (exports === undefined) return [];
  if (typeof exports === "string") return [[".", exports]];
  const keys = Object.keys(exports);
  const subpaths = keys.filter((key) => key === "." || key.startsWith("./"));
  // A bare conditions object ({ import, require, ... }) is the whole package.
  return subpaths.length === keys.length ? Object.entries(exports) : [[".", exports]];
}

const escapeRegExp = (literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What `*` stands for, read off the files the package actually ships.
 *
 * Node expands a wildcard against the filesystem, so a subpath pattern only
 * exists for the files that are there — which makes this the same question as
 * "did the tarball include them".
 *
 * A target may carry more than one `*`, and Node substitutes the SAME matched
 * value into all of them ("./dist/*\/*.js" is dist/<x>/<x>.js, not two
 * independent wildcards). So the first star captures and the rest backreference
 * it — a fresh `(.+)` each time would accept files Node never resolves.
 *
 * Splitting on `*` before escaping is also what keeps a second star out of the
 * regex as a quantifier: escaping the whole pattern and then substituting one
 * star left every later star raw, which is what CodeQL flagged.
 */
function starValues(pattern, files) {
  const [head, ...tail] = pattern.replace(/^\.\//, "").split("*");
  if (tail.length === 0) return [];
  const body = `${escapeRegExp(head)}(.+)${tail.map(escapeRegExp).join("\\1")}`;
  const matcher = new RegExp(`^${body}$`);
  return files.flatMap((file) => matcher.exec(file)?.slice(1, 2) ?? []);
}

function wildcardEntries(subpath, value, files) {
  const [first] = targetsOf(value);
  if (first === undefined) return [];
  // replaceAll, per the same rule: every `*` takes the matched value.
  return [...new Set(starValues(first, files))].sort().map((star) => ({
    subpath: subpath.replaceAll("*", star),
    targets: targetsOf(value).map((target) => target.replaceAll("*", star)),
  }));
}

/** Concrete { subpath, targets } pairs, wildcards expanded. */
export function exportEntries(manifest, files) {
  return exportPairs(manifest.exports).flatMap(([subpath, value]) =>
    subpath.includes("*")
      ? wildcardEntries(subpath, value, files)
      : [{ subpath, targets: targetsOf(value) }],
  );
}

/**
 * The pre-`exports` entry points, as { field, target } pairs.
 *
 * Same shape as an export entry so a caller can check both with one predicate,
 * but keyed by field name rather than subpath: `module` is not a subpath and
 * saying "exports[module]" in a failure message would send the reader to the
 * wrong half of the manifest.
 */
export function legacyEntries(manifest) {
  return LEGACY_FIELDS.filter((field) => typeof manifest[field] === "string").map((field) => ({
    field,
    target: manifest[field],
  }));
}

/**
 * A target's path relative to the package root, with the `./` prefix dropped —
 * the form `shippedFiles` returns, so a declared target and a shipped file are
 * comparable with one `Set.has`.
 */
export function targetPath(target) {
  return target.replace(/^\.\//, "");
}
