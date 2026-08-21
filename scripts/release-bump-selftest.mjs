#!/usr/bin/env node
/**
 * Proves what each commit syntax ACTUALLY releases, against the committed
 * configs and the real analyzer.
 *
 * This exists because the repository has, twice, believed something about its
 * own release semantics that was not true — and both times the belief was
 * written down in comments, docs and a guard's error message, none of which can
 * be wrong out loud.
 *
 * The `!` shorthand was the case. `.releaserc.json` ran the ANGULAR preset,
 * whose headerPattern is `^(\w*)(?:\((.*)\))?: (.*)$` — a `!` before the colon
 * makes the whole header fail to match, so `fix(prisma)!: …` parsed with no
 * type and @semantic-release/commit-analyzer returned NO RELEASE. Not the major
 * its author meant, not a patch: nothing. It was once the only commit in range
 * for five packages and released none of them, and every step was green.
 *
 * The configs now override `parserOpts.headerPattern` and
 * `parserOpts.breakingHeaderPattern` so the shorthand parses and raises a
 * breaking note. That makes `!` and a `BREAKING CHANGE:` footer interchangeable
 * — which is what `scripts/breaking-change-guard.mjs` now tells authors, and
 * what the `major-approval` gate is wired to. Three things now depend on
 * a claim about a regex in a JSON file. This is the one that CHECKS it.
 *
 * Two properties, and the second is as load-bearing as the first:
 *
 *  - the analyzer, given the committed parserOpts, returns the level each
 *    syntax is documented to produce;
 *  - the analyzer under test is THE COPY semantic-release itself will load,
 *    resolved through `semantic-release`'s own module graph rather than
 *    imported by name. A separately-pinned devDependency could drift to a
 *    different version and assert the right answer about the wrong code.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * The analyzer, resolved through semantic-release's own module graph.
 *
 * Not imported by name: `@semantic-release/commit-analyzer` is a transitive
 * dependency, and adding it as a direct one would let this test pin a different
 * version from the one a release actually runs — asserting the right answer
 * about the wrong code, which is the failure mode this whole file exists to
 * prevent one level up.
 *
 * The diagnosis matters because this is the first script under `quality:release`
 * that needs an install at all; the lane ran without one for its whole life, and
 * the bare MODULE_NOT_FOUND it throws otherwise names neither the cause nor the
 * fix.
 */
async function loadAnalyzer() {
  const require_ = createRequire(import.meta.url);
  try {
    const fromSemanticRelease = createRequire(require_.resolve('semantic-release'));
    return await import(
      pathToFileURL(fromSemanticRelease.resolve('@semantic-release/commit-analyzer')).href
    );
  } catch (error) {
    console.log(
      '::error::Could not load @semantic-release/commit-analyzer through semantic-release. ' +
        'This self-test runs the REAL analyzer over the committed .releaserc.json files, so it ' +
        'needs the dependency tree — run `pnpm install` first. ' +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const { analyzeCommits } = await loadAnalyzer();

const config = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

/** The options a plugin is configured with, or null when it is not configured. */
function pluginOptions(cfg, name) {
  for (const entry of cfg.plugins ?? []) {
    if (Array.isArray(entry) && entry[0] === name) return entry[1] ?? {};
    if (entry === name) return {};
  }
  return null;
}

let failures = 0;
function check(what, ok, detail) {
  if (ok) {
    console.log(`  ok  ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}\n    ${detail}`);
}

const packageDirs = readFileSync(join(ROOT, 'release-packages.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

// ── The configs agree with each other ───────────────────────────────────────
//
// Every package's config is byte-identical by construction. That is not tidiness:
// a release runs per package, so a parserOpts that reached 31 of them would give
// one package different semantics from its siblings — and the difference would
// surface as a package that mysteriously never cuts a major.
const texts = new Set(
  packageDirs.map((dir) => readFileSync(join(ROOT, dir, '.releaserc.json'), 'utf8')),
);
check(
  'every package release config is identical',
  texts.size === 1,
  `${texts.size} distinct configs across ${packageDirs.length} packages — a release runs\n    ` +
    `per package, so one that differs releases by different rules than its siblings.`,
);

// ── Both plugins parse alike ────────────────────────────────────────────────
//
// commit-analyzer decides the LEVEL and release-notes-generator renders the
// NOTES; they parse the same commits independently. Given different parserOpts
// the version would be a major while its release notes silently omitted the
// breaking section that explains why.
for (const path of ['.releaserc.json', join(packageDirs[0], '.releaserc.json')]) {
  const cfg = config(path);
  const analyzer = pluginOptions(cfg, '@semantic-release/commit-analyzer');
  const notes = pluginOptions(cfg, '@semantic-release/release-notes-generator');
  check(
    `${path}: the analyzer and the notes generator share one parserOpts`,
    analyzer !== null &&
      notes !== null &&
      JSON.stringify(analyzer.parserOpts) === JSON.stringify(notes.parserOpts) &&
      analyzer.parserOpts !== undefined,
    `a version cut as a major whose notes omit the breaking section is worse than\n    ` +
      `either failure alone. analyzer=${JSON.stringify(analyzer)} notes=${JSON.stringify(notes)}`,
  );
}

// ── What each syntax releases ───────────────────────────────────────────────
const PARSER = pluginOptions(config('.releaserc.json'), '@semantic-release/commit-analyzer');

const context = (message) => ({
  commits: [{ hash: '0'.repeat(40), message, subject: message.split('\n')[0] }],
  logger: { log() {}, error() {} },
});

/**
 * `null` means NO RELEASE — the state that made `!` dangerous, and the reason
 * this table spells out every level rather than only checking the majors. A
 * parserOpts typo that broke ordinary `fix:` commits would be a repo-wide
 * outage, and it would look exactly like the majors working.
 */
const EXPECTED = [
  // Every way of SAYING "this breaks" now lands as a MINOR. The parserOpts above
  // are still what makes `!` parse at all — before them the header matched
  // nothing and the commit was worth no release, silently. What changed is only
  // where "breaking" is spent: `releaseRules` maps it to `minor`, because a
  // routine "this config is required now" tightening is not a migration anyone
  // schedules, and both of these vectors are one keystroke or one line-wrap
  // from being written by accident.
  ['feat(cart)!: drop the legacy port', 'minor', 'the `!` shorthand, scoped'],
  ['feat!: drop the legacy port', 'minor', 'the `!` shorthand, unscoped'],
  ['fix(cart)!: drop the legacy port', 'minor', '`!` on a non-feat type'],
  ['feat(cart): add x\n\nBREAKING CHANGE: the port is gone', 'minor', 'the footer'],
  ['feat(cart)!: both\n\nBREAKING CHANGE: gone', 'minor', 'both at once'],

  // The one thing that spends a major, and it has to be typed on purpose.
  ['feat(cart): rebuild the API\n\nRELEASE-MAJOR: every port moves', 'major', 'the RELEASE-MAJOR marker'],
  ['feat(cart)!: x\n\nRELEASE-MAJOR: deliberate', 'major', 'the marker wins over a mere `!`'],

  ['feat(cart): add a port', 'minor', 'an ordinary feat'],
  ['fix(cart): correct the total', 'patch', 'an ordinary fix'],
  ['chore(cart): tidy the imports', null, 'a chore, which releases nothing'],
  ['feat(cart): mentions a BREAKING CHANGE: mid-line', 'minor', 'a mid-line mention is not a footer'],
];

for (const [message, expected, why] of EXPECTED) {
  const actual = await analyzeCommits(PARSER, context(message));
  check(
    `${why} -> ${expected ?? 'no release'}`,
    actual === expected,
    `"${message.split('\n')[0]}" analysed as ${actual ?? 'no release'}, expected ` +
      `${expected ?? 'no release'}.\n    ` +
      `parserOpts: ${JSON.stringify(PARSER.parserOpts)}`,
  );
}

console.log(
  failures === 0
    ? '\nrelease semantics match what the guard and the docs claim'
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
