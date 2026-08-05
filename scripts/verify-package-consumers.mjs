// Prove the PUBLISHED packages work for someone who is not us.
//
// Everything this repo's other gates run — lint, types, unit tests, quality —
// runs inside the pnpm workspace, where a sibling import resolves regardless of
// what the manifest declares and every file is on disk regardless of what
// `files` would ship. Both are the opposite of a consumer's situation, so all
// four of the packaging bugs below passed a fully green CI and were found by
// hand, one release at a time, in an app that had already installed them:
//
//   typescript-config   shipped an EMPTY tarball for three releases — `files`
//                       was boilerplate (src/dist/prisma/*.js) and the package
//                       is nothing but .json
//   eslint-config       declared none of the nine plugins its configs import;
//                       they were devDependencies, which consumers never get
//   product-research    never exported vtexAuthInit — reachable in the
//                       workspace by relative path, impossible from a tarball
//   payments-frontend   kept a real dependency in devDependencies; a type-only
//                       import still needs the declarations to compile
//
// So this gate asserts nothing about the source tree. It packs what npm would
// upload, installs it into a consumer outside the workspace with --omit=dev,
// and checks the things a consumer finds out the hard way: that the package
// contains files at all, that every path its `exports` promises is really in
// the tarball and resolvable by Node, that the entry points it ships can be
// imported, and that everything they import is actually installed.
//
// Run after `pnpm build` (shared-helpers publishes ./dist, which tsc writes).
import { existsSync, readdirSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import {
  assertMatchesPublishList,
  installConsumerFixture,
  publishableDirs,
  readManifest,
} from "./lib/pack-workspace.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILTINS = new Set(builtinModules);

// Source we scan for imports. Tests and stories are excluded because they are
// the one place a devDependency import is legitimate — vitest and
// testing-library are meant to be absent from a consumer's tree.
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /(?:\.(?:test|spec|stories|test-story)\.|(?:^|\/)(?:__tests__|tests)\/)/;

// Files that carry no information about whether a package is usable.
const BOILERPLATE = /^(?:package\.json|README|LICEN[CS]E|CHANGELOG)/i;

/** Every file inside an installed package, as package-relative paths. */
function shippedFiles(pkgDir) {
  return readdirSync(pkgDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(pkgDir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.startsWith("node_modules/"));
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

/**
 * What `*` stands for, read off the files the package actually ships.
 *
 * Node expands a wildcard against the filesystem, so a subpath pattern only
 * exists for the files that are there — which makes this the same question as
 * "did the tarball include them".
 */
function starValues(pattern, files) {
  const escaped = pattern.replace(/^\.\//, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escaped.replace("*", "(.+)")}$`);
  return files.flatMap((file) => matcher.exec(file)?.slice(1, 2) ?? []);
}

function wildcardEntries(subpath, value, files) {
  const [first] = targetsOf(value);
  if (first === undefined) return [];
  return starValues(first, files).map((star) => ({
    subpath: subpath.replace("*", star),
    targets: targetsOf(value).map((target) => target.replace("*", star)),
  }));
}

/** Concrete { subpath, targets } pairs, wildcards expanded. */
function exportEntries(manifest, files) {
  return exportPairs(manifest.exports).flatMap(([subpath, value]) =>
    subpath.includes("*")
      ? wildcardEntries(subpath, value, files)
      : [{ subpath, targets: targetsOf(value) }],
  );
}

// ---------------------------------------------------------------- checks ---

/**
 * A package that ships nothing at all still installs, still resolves as a
 * name, and still fails every consumer — quietly, because npm reports success
 * at every step. typescript-config was in exactly this state for three
 * releases: three .json files, none of them matched by `files`.
 */
function checksShipsContent({ files }) {
  const meaningful = files.filter((file) => !BOILERPLATE.test(file));
  return meaningful.length > 0 ? [] : ["publishes no files beyond package.json/README — the tarball is empty"];
}

/** Every path `exports` promises is in the tarball. */
function checksExportTargets({ files, entries }) {
  const shipped = new Set(files);
  return entries.flatMap(({ subpath, targets }) =>
    targets
      .filter((target) => !shipped.has(target.replace(/^\.\//, "")))
      .map((target) => `exports["${subpath}"] points at ${target}, which is not in the tarball`),
  );
}

/**
 * ...and that Node agrees. The check above reads the manifest we just wrote;
 * this one asks the resolver the same question a consumer's bundler will,
 * which is the only answer that counts.
 */
function checksNodeResolves({ manifest, entries, requireFrom }) {
  return entries.flatMap(({ subpath }) => {
    const specifier = join(manifest.name, subpath).split(sep).join("/");
    try {
      requireFrom.resolve(specifier);
      return [];
    } catch (error) {
      return [`import "${specifier}" does not resolve: ${error.code ?? error.message}`];
    }
  });
}

/**
 * Entry points that are real JavaScript get imported for real.
 *
 * This is the check that catches a missing runtime dependency, and the reason
 * the fixture installs with --omit=dev: eslint-config's three configs import
 * nine plugins between them, and every one of those imports threw
 * ERR_MODULE_NOT_FOUND for consumers while this repo stayed green.
 */
async function checksEntriesImport({ pkgDir, entries }) {
  const targets = [...new Set(entries.flatMap(({ targets: paths }) => paths))];
  const executable = targets.filter((target) => /\.[cm]?js$/.test(target));
  const results = await Promise.all(
    executable.map((target) => importOrExplain(join(pkgDir, target), target)),
  );
  return results.flat();
}

async function importOrExplain(path, target) {
  try {
    await import(pathToFileURL(path).href);
    return [];
  } catch (error) {
    return [`importing ${target} failed: ${error.code ?? ""} ${error.message}`.trim()];
  }
}

/** The package name a module specifier belongs to. */
function packageOf(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/**
 * Bare specifiers, read with TypeScript's own scanner rather than a regex.
 *
 * Two earlier attempts at this used a regex and both reported prose out of
 * JSDoc comments as imports. preProcessFile is the compiler's real
 * pre-processor: it returns module specifiers and nothing else.
 */
function specifiersIn(pkgDir, file) {
  const source = ts.sys.readFile(join(pkgDir, file)) ?? "";
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((ref) => packageOf(ref.fileName))
    .filter((name) => !name.startsWith(".") && !name.startsWith("#"))
    .filter((name) => !BUILTINS.has(name) && !name.startsWith("node:"))
    .map((name) => ({ name, file }));
}

/** Names a consumer is entitled to assume are reachable from this package. */
function declaredNames(manifest) {
  return new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

/**
 * Everything the shipped source imports is something the manifest declares.
 *
 * The import()-based check above can only speak for the packages that ship
 * JavaScript; eighteen of the twenty ship TypeScript source, which nothing
 * executes at install time. This asks the same question statically, and it is
 * what would have caught payments-frontend declaring payments-backend as a
 * devDependency — a type-only import, invisible at runtime, fatal at the
 * consumer's `tsc`.
 *
 * The manifest is the subject, NOT the installed tree: report-builder declares
 * react-router-dom as an OPTIONAL peer, so npm installs nothing and a
 * server-only consumer is not made to carry a router it will never render.
 * Absent-but-declared is the design; absent-and-undeclared is the bug.
 */
function checksImportsAreDeclared({ manifest, pkgDir, files }) {
  const declared = declaredNames(manifest);
  const scannable = files.filter((file) => SOURCE.test(file) && !TEST_FILE.test(file));
  const undeclared = scannable
    .flatMap((file) => specifiersIn(pkgDir, file))
    .filter(({ name }) => !declared.has(name));
  return [...new Map(undeclared.map((use) => [use.name, use])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, file }) => `${file} imports "${name}", which the manifest never declares`);
}

/**
 * A `dependencies` entry that did not install is a range nobody can satisfy —
 * a sibling pinned to a version the registry does not have yet, most likely.
 * Unlike a peer, npm owes the consumer this one unconditionally.
 */
function checksDependenciesInstalled({ manifest, pkgDir, root }) {
  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => !isInstalled(name, pkgDir, root))
    .map((name) => `depends on "${name}", which npm did not install for the consumer`);
}

/** Node's own lookup: walk node_modules up from the package, stop at the root. */
function isInstalled(name, from, root) {
  const ancestors = [];
  let dir = from;
  while (dir.startsWith(root)) {
    ancestors.push(dir);
    dir = dirname(dir);
  }
  return ancestors.some((ancestor) => existsSync(join(ancestor, "node_modules", name)));
}

const CHECKS = [
  checksShipsContent,
  checksExportTargets,
  checksNodeResolves,
  checksImportsAreDeclared,
  checksDependenciesInstalled,
];

async function verify(context) {
  const sync = CHECKS.flatMap((check) => check(context));
  return [...sync, ...(await checksEntriesImport(context))];
}

// ------------------------------------------------------------------ main ---

function contextFor(name, root, requireFrom) {
  const pkgDir = join(root, "node_modules", ...name.split("/"));
  if (!existsSync(pkgDir)) return { name, missing: true };
  const files = shippedFiles(pkgDir);
  const manifest = readManifest(pkgDir);
  return { name, manifest, pkgDir, files, root, requireFrom, entries: exportEntries(manifest, files) };
}

/**
 * shared-helpers publishes ./dist, which only exists after tsc. Saying so here
 * beats letting every one of its exports report itself as missing from the
 * tarball, which is the same symptom as the bug this gate is named for.
 */
function checkBuildArtifacts(dirs) {
  return dirs.flatMap((dir) => {
    const manifest = readManifest(join(REPO_ROOT, dir));
    const needsDist = manifest.scripts?.build && (manifest.files ?? []).includes("dist");
    const built = existsSync(join(REPO_ROOT, dir, "dist"));
    return needsDist && !built ? [`${dir}/dist is missing — run \`pnpm build\` before this check`] : [];
  });
}

function report(title, problems) {
  if (problems.length === 0) return false;
  console.log(`\n✗ ${title}`);
  problems.forEach((problem) => console.log(`    ${problem}`));
  return true;
}

async function main() {
  const dirs = publishableDirs();
  const declared = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);
  const drift = declared.length > 0 ? assertMatchesPublishList(dirs, declared) : [];
  const unbuilt = checkBuildArtifacts(dirs);
  if (report("release configuration", drift) || report("build artifacts", unbuilt)) process.exit(1);

  console.log(`packing ${dirs.length} packages and installing them as a consumer would…`);
  const { root, names } = installConsumerFixture(dirs);
  console.log(`fixture: ${root}`);
  const requireFrom = createRequire(join(root, "package.json"));

  const failed = await Promise.all(
    names.map(async (name) => {
      const context = contextFor(name, root, requireFrom);
      if (context.missing) return report(name, ["did not install into the consumer at all"]);
      return report(name, await verify(context));
    }),
  );

  const broken = failed.filter(Boolean).length;
  if (broken > 0) {
    console.log(`\n${broken} of ${names.length} packages are broken for consumers.`);
    process.exit(1);
  }
  console.log(`\n✓ all ${names.length} packages install, resolve and import as published.`);
}

// `npm pack` shells out per package; surface a failure there as a plain message
// rather than a stack trace pointing into execFileSync.
main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.stderr) console.error(String(error.stderr).trim());
  process.exit(1);
});
