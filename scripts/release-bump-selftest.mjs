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
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { distTagArgs } from './lib/dist-tag.mjs';

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
// Every package releases by the same RULES. That is not tidiness: a release runs
// per package, so a parserOpts that reached 31 of them would give one package
// different semantics from its siblings — and the difference would surface as a
// package that mysteriously never cuts a major.
//
// The rules are everything but `branches`. `branches` says WHERE a package may
// release, not how its commits are read, and it is the one key that must be
// able to differ: a semantic-release maintenance branch
// (`release/<pkg>-<major>.<minor>.x`) is opted into by the one package whose old
// line needs a fix, and every sibling logs "not configured" on it and cuts
// nothing. Giving every package that entry instead would declare 37 lines that
// do not exist, each ready to publish under another package's dist-tag.
//
// So the divergence is allowed in exactly one shape, and that shape is checked
// as strictly as the rules are: `main` first, then only maintenance branches
// named after the package's OWN directory, whose `range` is the line and whose
// `channel` is the dist-tag scripts/publish.mjs will publish that branch under.
// A branch publish.mjs would refuse, or would tag under a different name from
// the channel semantic-release records, fails here instead of in CD.

/** Why one maintenance entry is out of shape for the package in `dir`, or null. */
function maintenanceProblem(dir, entry) {
  const shown = JSON.stringify(entry);
  const keys = entry !== null && typeof entry === 'object' ? Object.keys(entry).sort() : [];
  if (keys.join() !== 'channel,name,range') {
    return `${dir}: ${shown} is not a {name, range, channel} maintenance branch`;
  }
  let tag;
  try {
    tag = distTagArgs(entry.name)[1];
  } catch (error) {
    return `${dir}: ${shown}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const line = `${basename(dir)}-${entry.range}`;
  if (/^\d+\.\d+\.x$/.test(entry.range) && tag === line && entry.channel === line) return null;
  return (
    `${dir}: ${shown} must be { name: "release/${line}", range: "<major>.<minor>.x", ` +
    `channel: "${line}" } — its own line, published on dist-tag "${tag}"`
  );
}

/** Every way one package's `branches` departs from `main` + its own maintenance lines. */
function branchProblems(dir, branches) {
  if (!Array.isArray(branches) || branches[0] !== 'main') {
    return [`${dir}: \`branches\` must start with "main", got ${JSON.stringify(branches)}`];
  }
  return branches
    .slice(1)
    .map((entry) => maintenanceProblem(dir, entry))
    .filter((problem) => problem !== null);
}

/** Distinct rule sets across packages, and every out-of-shape `branches`. */
function releaseConfigProblems(configs) {
  const rules = new Set(configs.map(({ cfg }) => JSON.stringify({ ...cfg, branches: undefined })));
  const problems = configs.flatMap(({ dir, cfg }) => branchProblems(dir, cfg.branches));
  return { ruleSets: rules.size, problems };
}

const committed = packageDirs.map((dir) => ({ dir, cfg: config(join(dir, '.releaserc.json')) }));
const verdict = releaseConfigProblems(committed);
check(
  'every package releases by the same rules',
  verdict.ruleSets === 1,
  `${verdict.ruleSets} distinct rule sets across ${packageDirs.length} packages — a release runs\n    ` +
    `per package, so one that differs releases by different rules than its siblings.`,
);
check(
  'every package releases from main, plus only maintenance lines of its own',
  verdict.problems.length === 0,
  verdict.problems.join('\n    '),
);

// The allowance above must not blind the check it relaxes. Both mutations are
// applied to a copy of the committed configs, and each must still be caught.
const [first, ...rest] = committed;
const drifted = structuredClone(first);
pluginOptions(drifted.cfg, '@semantic-release/commit-analyzer').releaseRules = [];
check(
  'a package whose rules differ is still caught',
  releaseConfigProblems([drifted, ...rest]).ruleSets === 2,
  "dropping one package's releaseRules went unnoticed — the `branches` allowance hides rule drift",
);
const foreign = structuredClone(first);
const sibling = `${basename(rest[0].dir)}-1.0.x`;
foreign.cfg.branches = ['main', { name: `release/${sibling}`, range: '1.0.x', channel: sibling }];
check(
  "a maintenance line of another package's is refused",
  branchProblems(foreign.dir, foreign.cfg.branches).length === 1,
  `${first.dir} declaring ${sibling} went unnoticed — it would publish on another package's dist-tag`,
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
