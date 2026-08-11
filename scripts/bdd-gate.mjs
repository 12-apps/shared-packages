#!/usr/bin/env node
/* global process */
/**
 * The Gherkin gate — what stops `.feature` files from becoming decoration.
 *
 * A feature file is only worth having if it is the ACTUAL test. The failure
 * mode of BDD everywhere is the opposite: prose that once described a flow,
 * kept in the repo, drifting from the code with nothing to say so. This gate
 * makes that state impossible to commit:
 *
 *   1. GENERATION MUST SUCCEED — `bddgen` compiles every feature into a
 *      Playwright spec and fails on an undefined or ambiguous step. A scenario
 *      whose steps nobody implemented cannot merge.
 *   2. EVERY FEATURE MUST COMPILE TO A SPEC — a feature with no scenarios (or
 *      one that generation skipped) produces no spec, which would silently
 *      shrink the suite. Counted, not assumed.
 *   3. NO ORPHAN STEP DEFINITIONS — a definition no scenario uses is dead
 *      weight that reads as coverage. `bddgen export` lists every definition;
 *      the generated specs name every one actually bound.
 *   4. EVERY SCENARIO ASSERTS — a scenario with no `Then` is a script, not a
 *      test: it passes as long as the clicks land.
 *   5. THE COMPILED OUTPUT IS NEVER COMMITTED — a stale committed spec would
 *      run in place of the feature it no longer matches.
 *   6. NO SILENT SKIPS — `@skip` / `@fixme` on a scenario turns a journey off
 *      while leaving it in the file, which is exactly the drift this gate
 *      exists to prevent.
 *
 * WHERE IT RUNS FROM, AND WHY THAT IS THE HARNESS. In this repo the journeys
 * SHIP WITH THE PACKAGES — `packages/payments/e2e/features` and
 * `packages/report-builder/features` — and the only thing that compiles them is
 * the consumer harness, which is where playwright-bdd and the bdd config live.
 * So the gate reads the FEATURES from `packages/` (the source of truth, which
 * is what a diff changes) and asks `harness/frontend` to compile them (the only
 * place that can). Reimplementing generation here would be a second compiler to
 * disagree with the real one.
 *
 * It never starts a browser: it only compiles and inspects, so it costs a
 * couple of seconds once the harness is installed.
 *
 * Exit 0 = clean. Any violation prints the offending file and exits 1.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = join(ROOT, "packages");
/** The consumer harness — the only place with a bdd config and a compiler. */
const HARNESS = join(ROOT, "harness/frontend");
const GENERATED_DIR = join(HARNESS, ".features-gen");

/**
 * The directory a package ships the journeys THIS harness runs in.
 *
 * Named rather than discovered, because a packaged suite the harness does not
 * mount is a legitimate thing to ship: `@12-apps/payments-e2e` also exports
 * `features-platform`, the platform-operations journeys, as a SEPARATE opt-in
 * glob triple for the app that operates the platform. This harness mounts a
 * checkout and a reports surface, not a platform console, so those features
 * compile to nothing here — correctly. Scanning for every `.feature` under
 * `packages/` would report each of them as "compiled to no spec" and the gate
 * would be permanently red on a fact about the harness rather than about the
 * features.
 *
 * A second harness that DID mount the platform surface would add its own
 * directory name here alongside this one.
 */
const RUNNABLE_FEATURES_DIR = "features";

const problems = [];

/** Every file under `dir` whose name ends with `suffix`, recursively. */
function filesUnder(dir, suffix) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === "node_modules") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full, suffix);
    return full.endsWith(suffix) ? [full] : [];
  });
}

/**
 * A feature's identity, shared by its source and its compiled spec: the path
 * BELOW the `features/` directory it ships in.
 *
 * The two are otherwise unrelatable. A source lives at
 * `packages/report-builder/features/x.feature`; the harness compiles the
 * INSTALLED copy at `node_modules/@12-apps/report-builder/features/x.feature`,
 * and the directory names in between (`report-builder` versus `packages/…`,
 * `payments-e2e` versus `packages/payments/e2e`) match nothing. What both share
 * is everything after `features/`, which is also what bddgen mirrors into the
 * output directory.
 */
function featureKey(path) {
  const parts = path.split(sep);
  const at = parts.lastIndexOf(RUNNABLE_FEATURES_DIR);
  return at < 0 ? path : parts.slice(at + 1).join("/");
}

/** Whether a `.feature` is one of the ones this harness is meant to run. */
function isRunnable(path) {
  return path.split(sep).includes(RUNNABLE_FEATURES_DIR);
}

const featureFiles = filesUnder(PACKAGES, ".feature").filter(isRunnable);
if (featureFiles.length === 0) {
  console.error(
    `[bdd] no .feature files under ${relative(ROOT, PACKAGES)}/*/${RUNNABLE_FEATURES_DIR}`,
  );
  process.exit(1);
}

// Two packaged features sharing a name would be indistinguishable once
// compiled — the join above would let one of them stand in for the other, so a
// feature that produced NO spec could still pass rule 2.
const byKey = new Map();
for (const feature of featureFiles) {
  const key = featureKey(feature);
  const seen = byKey.get(key);
  if (seen) {
    problems.push(
      `${relative(ROOT, feature)} and ${relative(ROOT, seen)} ship the same feature name — ` +
        "rename one; a shipped feature's name is its identity once it is installed",
    );
  }
  byKey.set(key, feature);
}

if (!existsSync(join(HARNESS, "node_modules"))) {
  console.error(
    `[bdd] ${relative(ROOT, HARNESS)} is not installed, so nothing can compile the features.\n` +
      "      Run: pnpm build && node scripts/harness-install.mjs",
  );
  process.exit(1);
}

/** `npx <bin>` inside the harness, which is where playwright-bdd is installed. */
function bddgen(args, options = {}) {
  return execFileSync("npx", ["bddgen", ...args], { cwd: HARNESS, ...options });
}

// ---------------------------------------------------------------------------
// 1. Generation must succeed (undefined / ambiguous steps fail here).
// ---------------------------------------------------------------------------
console.error("[bdd] compiling features…");
try {
  bddgen(["test"], { stdio: "inherit" });
} catch {
  console.error(
    "[bdd] FAILED: features did not compile. An undefined step means a scenario " +
      "nobody implemented — add the step definition in the package's src/e2e/steps/.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Every feature compiled to a spec.
// ---------------------------------------------------------------------------
// Each generated spec opens with `// Generated from: <path>` naming the feature
// it came from, so the join is the compiler's own answer rather than a second
// guess at its path arithmetic.
const generated = filesUnder(GENERATED_DIR, ".spec.js");
const compiledKeys = new Set(
  generated.flatMap((file) => {
    const from = /^\/\/ Generated from:\s*(.+)$/m.exec(readFileSync(file, "utf8"));
    return from?.[1] ? [featureKey(from[1].trim())] : [];
  }),
);
for (const feature of featureFiles) {
  if (!compiledKeys.has(featureKey(feature))) {
    problems.push(
      `${relative(ROOT, feature)}: compiled to no spec — does it declare any Scenario?`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. No orphan step definitions.
// ---------------------------------------------------------------------------
// The generated specs carry each scenario's step TEXT verbatim, and
// `bddgen export` lists every declared PATTERN. A definition is used when some
// scenario's text matches it; anything left over is a step nobody speaks.
const stepTexts = generated.flatMap((file) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /await (?:Given|When|Then|And|But)\('((?:[^'\\]|\\.)*)'/g,
    ),
  ].map((match) => match[1].replace(/\\(['\\])/g, "$1")),
);

let exported = "";
try {
  exported = bddgen(["export"], { encoding: "utf8" });
} catch {
  problems.push("`bddgen export` failed — cannot verify step definitions are used");
}
const declared = [...exported.matchAll(/^\* (?:Given|When|Then) (.+)$/gm)].map((m) => m[1]);

/**
 * A declared step as a matcher. Patterns that open with `^` are already regular
 * expressions (that is how they were authored); anything else is a Cucumber
 * expression, whose three placeholders and optional `(s)` group are the whole
 * of the syntax used here.
 */
function toMatcher(pattern) {
  if (pattern.startsWith("^")) return new RegExp(pattern);
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{int\\\}/g, "(\\d+)")
    .replace(/\\\{string\\\}/g, '"([^"]*)"')
    .replace(/\\\{word\\\}/g, "(\\S+)")
    .replace(/\\\(([^)]+)\\\)/g, "(?:$1)?");
  return new RegExp(`^${escaped}$`);
}

if (declared.length === 0) {
  problems.push("`bddgen export` listed no step definitions — the gate would check nothing");
}
for (const pattern of declared) {
  if (!stepTexts.some((text) => toMatcher(pattern).test(text))) {
    problems.push(`step definition "${pattern}" is never used by any scenario`);
  }
}

// ---------------------------------------------------------------------------
// 4. Every scenario asserts something.
// ---------------------------------------------------------------------------
// A scenario of nothing but Given/When is a script, not a test: it passes as
// long as the clicks land. `Then` is where the expectation is.
for (const feature of featureFiles) {
  const lines = readFileSync(feature, "utf8").split("\n");
  let scenario = null;
  let asserts = false;
  const close = () => {
    if (scenario && !asserts) {
      problems.push(
        `${relative(ROOT, feature)}:${scenario.line}: scenario "${scenario.name}" has no Then — it asserts nothing`,
      );
    }
  };
  lines.forEach((line, index) => {
    const start = /^\s*Scenario(?: Outline)?:\s*(.+)$/.exec(line);
    if (start) {
      close();
      scenario = { name: start[1].trim(), line: index + 1 };
      asserts = false;
      return;
    }
    // `And`/`But` inherit the previous keyword, so only a literal `Then` (or an
    // And/But following one) counts — tracked by the flag, not re-derived.
    if (scenario && /^\s*Then\s/.test(line)) asserts = true;
  });
  close();
}

// ---------------------------------------------------------------------------
// 5. The compiled output is never committed.
// ---------------------------------------------------------------------------
// `.features-gen` is a build product: committing it lets a stale spec run in
// place of the feature it no longer matches, which is the drift this whole gate
// exists to prevent — reached from the other direction.
try {
  // The whole index, filtered here rather than by a pathspec: git's default
  // pathspecs are fnmatch, where `**` is not the recursive wildcard it looks
  // like — `**/.features-gen` silently matches nothing, so the check passed
  // while a compiled spec sat in the index.
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => path.split("/").includes(".features-gen"));
  if (tracked.length > 0) {
    problems.push(
      `${tracked[0]} is committed — .features-gen is generated output; keep it gitignored`,
    );
  }
} catch {
  // Not a git checkout (or git unavailable): nothing to assert about tracking.
}

// ---------------------------------------------------------------------------
// 6. No silent skips.
// ---------------------------------------------------------------------------
// Every packaged feature and every packaged step file, including the suites
// this harness does not mount: a journey turned off in place is the drift this
// gate exists to prevent wherever it is written down.
const stepFiles = filesUnder(PACKAGES, ".steps.ts");
const skipCandidates = [...filesUnder(PACKAGES, ".feature"), ...stepFiles];
for (const file of skipCandidates) {
  const text = readFileSync(file, "utf8");
  const line = text.split("\n").findIndex((entry) => /@(skip|fixme)\b/.test(entry));
  if (line >= 0) {
    problems.push(
      `${relative(ROOT, file)}:${line + 1}: @skip/@fixme disables a journey in place — ` +
        "fix it or delete it, but do not leave it looking present",
    );
  }
}

if (problems.length > 0) {
  console.error("\n[bdd] FAILED:");
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

console.error(
  `[bdd] ✓ ${featureFiles.length} features → ${generated.length} specs, ` +
    `${declared.length} step definitions, all used`,
);
