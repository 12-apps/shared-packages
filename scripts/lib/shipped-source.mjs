// One answer to "is this path shipped package source?", shared by the
// copy-portability and vocabulary-portability gates.
//
// It lived inside `copy-portability-gate.mjs` until the vocabulary gate
// needed the same answer. Two gates asking the same question from two
// hand-kept regexes is the drift both of them exist to prevent: the pair
// would disagree the first time either widened, and the direction that
// disagreement takes is always "one gate quietly stopped looking".
//
// ## Three ways a file is out of scope, and why each is a CATEGORY
//
// 1. NOT SHIPPED SOURCE. Only `packages/<name>/src/**` and
//    `packages/<group>/<name>/src/**` are a published package's source. A
//    harness page, a script, a doc and a workflow are this repo's own, and
//    the host-brand gate sweeps those with no allowlist.
//
// 2. NOT THE PRODUCT. Tests, stories, e2e worlds and Gherkin features
//    exercise product copy rather than shipping it — a spec that clicks
//    "Continuar com Google" is a spec, not a leak.
//
// 3. A NAMED PACK. A file whose name says what it is (`pt-BR.ts`, anything
//    under `locales/`) is the sanctioned way to ship another language: a
//    host imports it and passes it BY HAND, so choosing Portuguese is a line
//    in the host's diff rather than a silence.
//
// ## Category 2 is read from the MANIFEST, not only from a regex
//
// The regex spells the conventions (`__tests__/`, `*.stories.*`), and a
// package can also state the answer itself: every package here declares
// `files`, and a `!`-negation in it is the package saying, in the one place
// npm actually reads, that a path is not in the tarball. Three packages
// carry one beyond the shared set — `!src/stories/**` (payments/frontend),
// `!**/__stories__/**` (entity-lifecycle), `!docs/**` (jobs) — and the first
// is a directory of Storybook fixture stores that the copy gate fenced as
// six burn-down debts for its first weeks. They were never publishable: npm
// had been told so all along, and only the gate's private copy of the rule
// disagreed.
//
// ONLY negations are honoured, never the positive globs. That keeps the
// manifest able to SHRINK scope (a package declaring "this does not ship" is
// evidence) and never to widen it (a package with a careless `files` cannot
// exempt itself from a portability gate by accident). A package with no
// `files` field publishes everything, so it simply gets the regex.
import { existsSync, readFileSync } from "node:fs";

const SHIPPED_SOURCE = /^packages\/[^/]+(?:\/[^/]+)?\/src\/.+\.(?:ts|tsx|js|jsx|mjs)$/;
const CATEGORY_EXCLUDED =
  /(?:__tests__|__stories__|\.test\.|\.spec\.|\.stories\.|\.test-story\.|(?:^|\/)e2e\/|(?:^|\/)features\/|test-helpers)/;
const NAMED_PACK = /(?:pt-?br[^/]*\.(?:ts|tsx|js|jsx|mjs)$|(?:^|\/)locales\/)/i;

/**
 * One `files` glob as a regex over the package-relative path.
 *
 * npm's `files` uses gitignore-style globs. Only the shapes this repo's
 * manifests actually use are translated — `**`, `*`, `?` and literals — and
 * a pattern with no `/` matches at any depth, which is what makes
 * `*.test.*` and `**\/__tests__/**` mean the same thing npm means by them.
 */
export function globToRegExp(glob) {
  const anchored = glob.includes("/") ? glob : `**/${glob}`;
  let out = "";
  for (let i = 0; i < anchored.length; i += 1) {
    const ch = anchored[i];
    if (ch === "*" && anchored[i + 1] === "*") {
      // `**/` may match nothing at all, so the slash is part of the option.
      if (anchored[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const unpublishedCache = new Map();

/** The package root of a shipped-source path: everything before `/src/`. */
function packageRootOf(path) {
  const cut = path.indexOf("/src/");
  return cut === -1 ? null : path.slice(0, cut);
}

/** The `!`-negated `files` globs of a package, as regexes. Memoized. */
function unpublishedPatterns(root, readManifest = defaultReadManifest) {
  if (unpublishedCache.has(root)) return unpublishedCache.get(root);
  const manifest = readManifest(root);
  const patterns = (manifest?.files ?? [])
    .filter((entry) => typeof entry === "string" && entry.startsWith("!"))
    .map((entry) => globToRegExp(entry.slice(1)));
  unpublishedCache.set(root, patterns);
  return patterns;
}

function defaultReadManifest(root) {
  const manifestPath = `${root}/package.json`;
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/** Whether a package's own manifest excludes this path from its tarball. */
function isUnpublished(path, readManifest) {
  const root = packageRootOf(path);
  if (root === null) return false;
  const relative = path.slice(root.length + 1);
  return unpublishedPatterns(root, readManifest).some((re) => re.test(relative));
}

/** Whether a tracked path is shipped package source a portability gate reads. */
export function inScope(path, readManifest) {
  return (
    SHIPPED_SOURCE.test(path) &&
    !CATEGORY_EXCLUDED.test(path) &&
    !NAMED_PACK.test(path) &&
    !isUnpublished(path, readManifest)
  );
}

