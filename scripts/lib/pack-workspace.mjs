// Pack every publishable package and install the tarballs into a throwaway
// consumer OUTSIDE this workspace.
//
// WHY THIS EXISTS. Inside a pnpm workspace every sibling resolves whether or
// not its manifest says so, and every file is on disk whether or not `files`
// would ship it. Both are the opposite of what a consumer gets, so the whole
// class of packaging bug is invisible to a test that imports a sibling — which
// is how four of them reached the registry: typescript-config shipped an EMPTY
// tarball for three releases, eslint-config declared none of the nine plugins
// its configs import, product-research never exported vtexAuthInit, and
// payments-frontend hid a real dependency in devDependencies.
//
// The only way to see any of that is to install what npm would actually
// publish, somewhere the workspace cannot reach. That is all this module does;
// what to assert about the result belongs to the caller.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGES = join(REPO_ROOT, "packages");
const MANIFEST = "package.json";

/** npm output is only interesting when the command fails. */
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function subdirectories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => join(dir, entry.name));
}

export function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
}

// `packages/<pkg>` AND one level deeper: payments ships its halves as a nested
// workspace (packages/payments/{backend,frontend}), and a discovery that stops
// at the first level would quietly leave both out of every check here.
function workspaceDirs() {
  const top = subdirectories(PACKAGES);
  return [...top, ...top.flatMap(subdirectories)].filter((dir) =>
    existsSync(join(dir, MANIFEST)),
  );
}

/**
 * Every package this repo publishes, discovered structurally.
 *
 * Deliberately NOT read from PUBLISH_DIRS. That list is hand-maintained in
 * ci.yml, and a package missing from it is not a loud failure — it is a package
 * that silently never ships. Discovering the truth here and comparing against
 * the list (see `assertMatchesPublishList`) turns that into a red build.
 */
export function publishableDirs() {
  return workspaceDirs()
    .filter((dir) => !readManifest(dir).private)
    .map((dir) => relative(REPO_ROOT, dir))
    .sort();
}

/**
 * Hold ci.yml's PUBLISH_DIRS to the packages that actually exist.
 *
 * A name in the list that no longer exists breaks the release job; a package
 * that exists but is not listed never reaches the registry at all, and nothing
 * else in CI would say so.
 */
export function assertMatchesPublishList(discovered, declared) {
  const missing = discovered.filter((dir) => !declared.includes(dir));
  const stale = declared.filter((dir) => !discovered.includes(dir));
  return [
    ...missing.map((dir) => `${dir} is publishable but missing from PUBLISH_DIRS — it would never publish`),
    ...stale.map((dir) => `PUBLISH_DIRS names ${dir}, which is not a publishable package`),
  ];
}

/**
 * `npm pack` cannot read `workspace:*`, so prepare-publish.mjs rewrites every
 * interdependency to a concrete range first — exactly as the release job does.
 * That edits manifests in place, so the originals are restored afterwards;
 * this runs on PRs, against a checkout the developer also has open.
 */
function withPublishManifests(fn) {
  const saved = new Map(
    workspaceDirs().map((dir) => [join(dir, MANIFEST), readFileSync(join(dir, MANIFEST), "utf8")]),
  );
  const restore = () => saved.forEach((contents, path) => writeFileSync(path, contents));
  // `finally` alone is not enough. This workflow cancels superseded PR runs
  // (concurrency.cancel-in-progress) and a developer will Ctrl-C it, and a
  // killed process runs no finally block — leaving every manifest pinned to a
  // concrete version. Harmless in CI's throwaway checkout, but on a working
  // copy it looks exactly like someone deliberately dropped the workspace
  // protocol, and the next `pnpm install` resolves the siblings from the
  // registry. Restore on the signals too.
  const onSignal = () => {
    restore();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    run("node", [join(REPO_ROOT, "scripts/prepare-publish.mjs")], REPO_ROOT);
    return fn();
  } finally {
    restore();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function packOne(dir, destination) {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], join(REPO_ROOT, dir));
  const [packed] = JSON.parse(output);
  return { name: packed.name, tarball: join(destination, packed.filename) };
}

/** Tarballs for every given directory, keyed by package name. */
export function packAll(dirs, destination) {
  return withPublishManifests(() => new Map(dirs.map((dir) => Object.values(packOne(dir, destination)))));
}

/**
 * A consumer package.json wired to the tarballs.
 *
 * `overrides` repeats the same mapping because a dependency of a dependency
 * would otherwise be fetched from the registry: payments-frontend depends on
 * payments-backend, and resolving that to the PUBLISHED version would test last
 * week's code instead of this pull request's.
 */
function consumerManifest(tarballs) {
  const specs = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]));
  return {
    name: "consumer-fixture",
    version: "0.0.0",
    private: true,
    description: "Throwaway consumer — installs the packed tarballs the way an app would.",
    dependencies: specs,
    overrides: specs,
  };
}

/**
 * Pack, install, and hand back where everything landed.
 *
 * The fixture lives in the OS temp directory on purpose. Anywhere under this
 * repo would be matched by pnpm-workspace.yaml, pnpm would link the packages
 * straight back to `packages/`, and the check would go green against the very
 * source layout it exists to look past.
 *
 * `--omit=dev` is the load-bearing flag: it is what makes a plugin left in
 * devDependencies genuinely absent, the way it is for a consumer.
 */
export function installConsumerFixture(dirs) {
  const root = mkdtempSync(join(tmpdir(), "consumer-fixture-"));
  const tarballs = packAll(dirs, root);
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(consumerManifest(tarballs), null, 2)}\n`);
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], root);
  return { root, names: [...tarballs.keys()] };
}
