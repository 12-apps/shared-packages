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
// Needs no `pnpm build` first: `packAll` builds the workspace before it packs,
// so the dist a tarball carries is this checkout's rather than whatever was left
// on disk. It used to be the caller's job, guarded by a check that only asked
// whether `dist/` EXISTED — which a stale one does.
import { existsSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  exportEntries,
  legacyEntries,
  meaningfulFiles,
  shippedFiles,
  targetPath,
} from "./lib/export-map.mjs";
import {
  assertMatchesPublishList,
  installConsumerFixture,
  publishableDirs,
  readManifest,
} from "./lib/pack-workspace.mjs";

const BUILTINS = new Set(builtinModules);

// Source we scan for imports. Tests and stories are excluded because they are
// the one place a devDependency import is legitimate — vitest and
// testing-library are meant to be absent from a consumer's tree.
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /(?:\.(?:test|spec|stories|test-story)\.|(?:^|\/)(?:__tests__|tests)\/)/;

// ---------------------------------------------------------------- checks ---

/**
 * A package that ships nothing at all still installs, still resolves as a
 * name, and still fails every consumer — quietly, because npm reports success
 * at every step. typescript-config was in exactly this state for three
 * releases: three .json files, none of them matched by `files`.
 */
function checksShipsContent({ files }) {
  const meaningful = meaningfulFiles(files);
  return meaningful.length > 0 ? [] : ["publishes no files beyond package.json/README — the tarball is empty"];
}

/** Every path `exports` promises is in the tarball. */
function checksExportTargets({ files, entries }) {
  const shipped = new Set(files);
  return entries.flatMap(({ subpath, targets }) =>
    targets
      .filter((target) => !shipped.has(targetPath(target)))
      .map((target) => `exports["${subpath}"] points at ${target}, which is not in the tarball`),
  );
}

/**
 * ...and so is every path the PRE-`exports` fields promise.
 *
 * `exports` wins wherever it is read, which is why a dead `main`/`module`/`types`
 * is survivable — and why nobody notices one. It is still what a classic
 * `moduleResolution` reads, and `@12-apps/ui`'s `module` named a `dist/index.mjs`
 * tsup has never emitted for as long as the package has been dual-format.
 */
function checksLegacyEntryFields({ files, manifest }) {
  const shipped = new Set(files);
  return legacyEntries(manifest)
    .filter(({ target }) => !shipped.has(targetPath(target)))
    .map(({ field, target }) => `${field} points at ${target}, which is not in the tarball`);
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
 *
 * ## An absent OPTIONAL peer is the design, not a break
 *
 * The fixture is a bare consumer: npm installs a package's dependencies and its
 * REQUIRED peers, and nothing at all for a peer marked optional. So an entry
 * that exists to adapt an optional peer — `@12-apps/app-shell/hono` is a Hono
 * adapter, `./react` is a React tower — cannot be imported there, and no
 * packaging change could make it so. Failing on that would be asking a package
 * to promise, in a consumer that opted OUT, that the thing it opted out of
 * works.
 *
 * `checksImportsAreDeclared` already says this in as many words — *"the manifest
 * is the subject, NOT the installed tree … absent-but-declared is the design;
 * absent-and-undeclared is the bug"*. This check simply never had to apply the
 * rule: until `@12-apps/app-shell` compiled its entries, no shipped `.js` in
 * this repo had a RUNTIME import of an optional peer. The others' optional-peer
 * imports are all type-only and erase (`impersonation` and `report-builder`'s
 * `./e2e`, `app-shell`'s own `./vite`), and `observability-frontend/vite`
 * imports `@sentry/vite-plugin`, which is a real dependency.
 *
 * So the excuse is narrow and it is the manifest that grants it: the ONE
 * package Node names as missing has to be declared, by this manifest, as an
 * optional peer. Anything else still fails — an undeclared import (the
 * eslint-config case: those were devDependencies, which `declaredNames` does not
 * include), a REQUIRED peer that is absent (npm installs those, so absence means
 * something is genuinely wrong), a syntax error, a throwing top level, a bad
 * export. Skips are PRINTED rather than swallowed, because a check nobody can
 * see the extent of is the thing this file exists to replace.
 */
async function checksEntriesImport({ name, manifest, pkgDir, entries }) {
  const targets = [...new Set(entries.flatMap(({ targets: paths }) => paths))];
  const executable = targets.filter((target) => /\.[cm]?js$/.test(target));
  const results = await Promise.all(
    executable.map((target) => importOrExplain(join(pkgDir, target), target, manifest, name)),
  );
  return results.flat();
}

/** Optional peers, the only absences an entry is allowed to fail on. */
function optionalPeers(manifest) {
  return new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional === true)
      .map(([peer]) => peer),
  );
}

/**
 * The package Node could not find, read from its own message.
 *
 * `ERR_MODULE_NOT_FOUND` carries no structured field for it, and the quoted name
 * is the PACKAGE — `hono/cookie` is reported as `hono` — which is exactly the
 * granularity `peerDependenciesMeta` is keyed at. An unparseable message returns
 * null and the entry fails, because an excuse nobody can name is not one.
 */
function missingPackageOf(error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") return null;
  return /Cannot find package '([^']+)'/.exec(error.message ?? "")?.[1] ?? null;
}

/**
 * A dependency deep-importing ITSELF, which no packaging change here can reach.
 *
 * MUI 6 ships no `exports` map, so under Node ESM only the `@mui/material` ROOT
 * resolves and every deep path is `ERR_UNSUPPORTED_DIR_IMPORT`. That much IS
 * ours to avoid, and `@12-apps/ui` now does — it imports the root barrel. What
 * is not ours is that MUI's internals deep-import each other:
 *
 *     Directory import '…/node_modules/@mui/material/utils' is not supported
 *     resolving ES modules imported from
 *     …/node_modules/@mui/icons-material/esm/utils/createSvgIcon.js
 *
 * Every component rendering an icon lands there — 15 of them in `ui` — and the
 * importing module is a dependency's own file, so no source change in this
 * repository is on that path. Asserting the property anyway does not make the
 * package loadable; it makes the gate permanently red, which is how a gate stops
 * being read.
 *
 * The excuse is therefore keyed on WHO could not resolve, never on which package
 * is under test: the failing import must ORIGINATE inside a third-party
 * dependency. An import from our OWN built output still fails — which is what
 * caught the four `@mui/material/styles` imports fixed alongside this — as does
 * every other error. Skips are PRINTED, like the optional-peer skip above.
 */
const IMPORTED_FROM = /imported from\s+(\S*[/\\]node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/;

function foreignDeepImport(error) {
  if (error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") return null;
  const importer = IMPORTED_FROM.exec(error.message ?? "")?.[1];
  if (!importer) return null;
  // The packages under test are installed into the fixture's node_modules too,
  // so "inside node_modules" alone would excuse our own deep imports.
  if (/[/\\]node_modules[/\\]@12-apps[/\\]/.test(importer)) return null;
  return importer.split(/node_modules[/\\]/).pop();
}

async function importOrExplain(path, target, manifest, name) {
  try {
    await import(pathToFileURL(path).href);
    return [];
  } catch (error) {
    const missing = missingPackageOf(error);
    if (missing !== null && optionalPeers(manifest).has(missing)) {
      console.log(`    · ${name} ${target}: not imported — optional peer "${missing}" is absent`);
      return [];
    }
    const foreign = foreignDeepImport(error);
    if (foreign !== null) {
      console.log(
        `    · ${name} ${target}: not imported — "${foreign}" deep-imports itself, ` +
          `which no change in this repository can resolve`,
      );
      return [];
    }
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
  checksLegacyEntryFields,
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
  if (report("release configuration", drift)) process.exit(1);

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
