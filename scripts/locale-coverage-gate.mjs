// The locale-coverage gate: a package that ships one language ships them all.
//
// The copy port (FUT-760) made every rendered sentence required host config and
// gave each package a NAMED pack — `pt-BR.ts`, or a file under `locales/`. That
// answered "whose words are these?" and left "which language?" untouched, and
// the failure mode of adding a second language one package at a time is
// specific and quiet: nineteen packages advertise English, eleven of them
// actually have it, and the adopter finds out one screen at a time.
//
// So this asserts the completeness property directly. For every package that
// ships a locale pack at all, EVERY canonical locale must have a file beside
// it. The canonical list is read from `packages/i18n/src/core/locale.ts` rather
// than restated here — a second hand-kept copy is the drift this repo has
// already paid for twice (the two portability gates share
// `lib/shipped-source.mjs` for exactly this reason).
//
// ## WHAT IT LOOKS AT
//
// A LOCALE FILE is a tracked file under a package's `src/` whose basename
// starts with a canonical tag (`pt-BR.ts`, `en-US.ts`, `pt-BR.form.ts`) or that
// sits in a `locales/` folder named for one (`locales/pt-BR.ts`). Both spellings
// are legal because `@12-apps/ui` split its pack per component family before
// this existed and renaming eight files across a published package is a
// migration nobody asked for.
//
// Files are grouped by (package, family), where the family is whatever follows
// the tag — so `pt-BR.form.ts` needs `en-US.form.ts` and not merely some other
// English file elsewhere in the package. A pack split seven ways that grew one
// English file would otherwise read as complete.
//
// ## THE RATCHET
//
// `.locale-coverage.json` lists the packages still to be ported, each with a
// written reason. SHRINK-ONLY in both directions: a package not on the list
// must be complete, and a listed package that IS complete fails as stale
// (delete its line). That is what makes the burn-down visible while it runs and
// impossible to forget when it ends.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LABEL = "[locale-coverage]";
const EXCEPTIONS_PATH = ".locale-coverage.json";
const CANONICAL_SOURCE = "packages/i18n/src/core/locale.ts";

/**
 * The canonical tags, parsed out of the one module that declares them.
 *
 * Read rather than imported because this script is plain node run from the repo
 * root and the package ships as TypeScript source; a regex over one `as const`
 * array is the cheapest honest way to stay in step with it. If the shape of
 * that declaration ever changes the gate FAILS rather than falling back to a
 * guess — a coverage gate that quietly checks nothing is worse than none.
 */
export function canonicalLocales(source) {
  const block = source.match(/export const LOCALES = \[([^\]]*)\] as const;/);
  if (!block) {
    throw new Error(
      `${LABEL} could not read LOCALES from ${CANONICAL_SOURCE}. ` +
        "The gate reads that declaration to know which languages to require; " +
        "update this parser in the same commit that changes its shape.",
    );
  }
  return [...block[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((match) => match[1] ?? match[2]);
}

/** `packages/<name>` or `packages/<group>/<name>` for a path under `src/`. */
function packageOf(path) {
  const parts = path.split("/");
  const cut = parts.indexOf("src");
  if (cut < 2) return null;
  return parts.slice(0, cut).join("/");
}

/**
 * The (tag, family) a locale file declares, or `null` if it is not one.
 *
 * The family is the rest of the basename — `pt-BR.ts` is family `""`, and
 * `pt-BR.form.ts` is family `form`. A file under `locales/` uses the same rule
 * on its own basename, so `locales/pt-BR.ts` and a sibling `pt-BR.ts` cannot
 * collide into one entry.
 */
export function localeFileOf(path, locales) {
  if (!/^packages\/[^/]+(?:\/[^/]+)?\/src\//.test(path)) return null;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const stem = basename.replace(/\.(?:ts|tsx|js|jsx|mjs)$/, "");
  if (stem === basename) return null;

  // The tag must be a DELIMITED segment, matching `lib/shipped-source.mjs`'s
  // exemption rule: all four spellings this repo uses are legal (`pt-BR`,
  // `pt-BR.form`, `mail-templates.pt-BR`, `setup-guide-pt-BR`), and `br` on its
  // own is not a language.
  const tag = locales.find((locale) =>
    new RegExp(`(?:^|[.-])${locale}(?:\\.|$)`).test(stem),
  );
  if (!tag) return null;

  // The family is the name with the tag and ONE adjacent delimiter removed, so
  // `setup-guide-pt-BR` pairs with `setup-guide-en-US` and not merely with some
  // other English file in the same folder.
  const at = stem.indexOf(tag);
  const before = stem.slice(0, at).replace(/[.-]$/, "");
  const after = stem.slice(at + tag.length).replace(/^[.-]/, "");
  const family = [before, after].filter(Boolean).join(".");
  const folder = path.slice(0, path.lastIndexOf("/"));
  return { tag, family, folder, package: packageOf(path) };
}

function readExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) return {};
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
}

/** Every (package, folder, family) group that has at least one locale file. */
export function groupLocaleFiles(paths, locales) {
  const groups = new Map();
  for (const path of paths) {
    const entry = localeFileOf(path, locales);
    if (!entry?.package) continue;
    const key = `${entry.folder}|${entry.family}`;
    const group = groups.get(key) ?? { package: entry.package, key, tags: new Set() };
    group.tags.add(entry.tag);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Which packages are missing which tags, as report lines keyed by package. */
export function findGaps(groups, locales) {
  const gaps = new Map();
  for (const group of groups) {
    const missing = locales.filter((locale) => !group.tags.has(locale));
    if (missing.length === 0) continue;
    const lines = gaps.get(group.package) ?? [];
    lines.push(`${group.key.replace("|", " family=")} is missing ${missing.join(", ")}`);
    gaps.set(group.package, lines);
  }
  return gaps;
}

function main() {
  const locales = canonicalLocales(readFileSync(CANONICAL_SOURCE, "utf8"));
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const gaps = findGaps(groupLocaleFiles(tracked, locales), locales);
  const exceptions = readExceptions();
  const failures = [];

  for (const [pkg, lines] of gaps) {
    if (pkg in exceptions) continue;
    failures.push(
      `${pkg} ships a locale pack but not every language:\n    ${lines.join("\n    ")}`,
    );
  }

  for (const pkg of Object.keys(exceptions)) {
    if (gaps.has(pkg)) continue;
    failures.push(
      `${pkg} is listed in ${EXCEPTIONS_PATH} but is already complete — delete its line (the ratchet only shrinks).`,
    );
  }

  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} problem(s):\n\n  ${failures.join("\n\n  ")}\n`);
    console.error(
      `${LABEL} every package shipping copy must speak ${locales.join(" and ")}. ` +
        `A package mid-port earns a line in ${EXCEPTIONS_PATH} with a written reason; ` +
        "the list may only ever shrink.\n",
    );
    process.exit(1);
  }

  const groups = groupLocaleFiles(tracked, locales);
  const complete = groups.filter((group) => locales.every((locale) => group.tags.has(locale)));
  console.log(
    `${LABEL} ok — ${complete.length} of ${groups.length} pack group(s) speak ` +
      `${locales.join(" and ")}; ${Object.keys(exceptions).length} package(s) still to port.`,
  );
}

if (process.argv[1]?.endsWith("locale-coverage-gate.mjs")) main();
