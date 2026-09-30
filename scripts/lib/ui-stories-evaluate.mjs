// The PURE half of the ui-stories gate (FUT-2619): given the served Storybook
// index, the test-runner's Jest JSON, the exception ledger, the flaky
// quarantine and origin/main's ledger, decide what fails. No I/O here, so
// `scripts/ui-stories-selftest.mjs` can hold every rule against fixtures.
//
// A story is named everywhere by the same key, `"<title> › <story name>"` —
// the runner's own `ancestorTitles`, and the string a quarantine entry's
// `titlePattern` is matched against:
//
//   "Overlays/Dialog/Tests › 🎯 Focus Management Test"
import { posix } from "node:path";

import { checkLedger, isArgument } from "./exception-ledger.mjs";

export const LEDGER_PATH = ".ui-stories-exceptions.json";

/** Only the `*.test.stories.tsx` suites are in scope. */
const IN_SCOPE = /\.test\.stories\.tsx$/;

/** Where the runner keeps the stories: every importPath is relative to it. */
const STORYBOOK_ROOT = "packages/ui";

export const keyOf = (title, name) => `${title} › ${name}`;

/** An index `importPath` (`./src/…`, `../product-research-ui/src/…`) as a repo path. */
export const specOf = (importPath) => posix.normalize(posix.join(STORYBOOK_ROOT, importPath));

// eslint-disable-next-line no-control-regex -- ANSI colour codes are control characters by definition
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The first lines of a failure, colourless — enough to name the cause in a CI
 * log. The runner opens every failure with a debug link and a `Message:`
 * header; the cause starts after that header.
 */
function excerpt(message, lines = 8) {
  const text = String(message ?? "").replace(ANSI, "");
  const at = text.indexOf("\nMessage:\n");
  return (at === -1 ? text : text.slice(at + "\nMessage:\n".length))
    .split("\n")
    // Jest's own frames name the runner's machinery, never the story.
    .filter((line) => line.trim() !== "" && !/^\s*at .*node_modules/.test(line))
    .slice(0, lines)
    .join("\n        ");
}

/** key -> { id, spec } for every in-scope story in the served index. */
function scopeFromIndex(index) {
  const scope = new Map();
  for (const entry of Object.values(index?.entries ?? {})) {
    if (entry.type !== "story" || !IN_SCOPE.test(entry.importPath ?? "")) continue;
    scope.set(keyOf(entry.title, entry.name), { id: entry.id, spec: specOf(entry.importPath) });
  }
  return scope;
}

/**
 * The runner's Jest JSON as key -> { status, message }, plus the suites that
 * died before running a single story (a generated test file that would not
 * load reports a suite failure with no assertions).
 */
function readResults(results) {
  const suites = results?.testResults ?? [];
  const suiteErrors = suites
    .filter((suite) => (suite.assertionResults ?? []).length === 0 && suite.status === "failed")
    .map((suite) => `${posix.basename(suite.name ?? "?")}: ${excerpt(String(suite.message ?? "").replace(/●\s*Test suite failed to run/, ""))}`);
  const outcomes = new Map(
    suites
      .flatMap((suite) => suite.assertionResults ?? [])
      .map((a) => [a.ancestorTitles.join(" › "), { status: a.status, message: a.failureMessages?.[0] }]),
  );
  return { outcomes, suiteErrors };
}

/**
 * The selection is EXACTLY the `*.test.stories.tsx` stories. A story that did
 * not run fails (a `!test` tag or a broken pattern must not switch a suite off
 * quietly), and so does one that ran from outside the scope (the pattern
 * widened, or a non-test file took a `…/Tests` title).
 */
function coverageFailures(scope, outcomes, suiteErrors) {
  const failures = suiteErrors.map((e) => `a generated suite failed to run: ${e}`);
  if (outcomes.size === 0) {
    failures.push("the runner reported no stories at all — a gate that ran nothing has proven nothing");
    return failures;
  }
  for (const [key, { spec }] of scope) {
    if (!outcomes.has(key)) failures.push(`${key} (${spec}) is a test story but produced no result — it did not run`);
  }
  for (const key of outcomes.keys()) {
    if (!scope.has(key)) failures.push(`${key} ran but is not in a *.test.stories.tsx file — the selection widened`);
  }
  return failures;
}

/** A quarantine entry's regex, or null when it does not compile (quality:quarantine rejects those too). */
function patternOf(entry) {
  try {
    return new RegExp(entry.titlePattern);
  } catch {
    return null;
  }
}

/** Does `entry` name this story? `spec` is the source path, `titlePattern` is tried on the key. */
const matches = (entry, key, spec) => entry.spec === spec && patternOf(entry)?.test(key) === true;

/** Split the quarantine: entries still honoured today, and the ones that expired. */
function splitQuarantine(entries, today) {
  const valid = (entries ?? []).filter((e) => e && typeof e.spec === "string" && typeof e.titlePattern === "string");
  return {
    active: valid.filter((e) => typeof e.expiresAt === "string" && e.expiresAt >= today),
    expired: valid.filter((e) => typeof e.expiresAt !== "string" || e.expiresAt < today),
  };
}

/**
 * The failing in-scope stories, minus those an ACTIVE quarantine entry names.
 * An expired entry is not honoured: its story's failure counts again.
 */
function applyQuarantine(failed, scope, quarantine) {
  const findings = new Set();
  const quarantined = [];
  const expiredHits = [];
  for (const key of failed) {
    const { spec } = scope.get(key);
    const active = quarantine.active.find((e) => matches(e, key, spec));
    if (active) {
      quarantined.push(`${key} — quarantined by ${active.ticket} until ${active.expiresAt}, result ignored`);
      continue;
    }
    const stale = quarantine.expired.find((e) => matches(e, key, spec));
    if (stale) expiredHits.push(`${key} — ${stale.ticket}'s quarantine expired on ${stale.expiresAt}, no longer honoured`);
    findings.add(key);
  }
  return { findings, quarantined, expiredHits };
}

/**
 * Every entry is `grandfathered` and argued. A permanently `exempt` failing
 * test is not a thing — a test either guards something or is deleted — and
 * "known failure" is a label, not the cause somebody has to fix.
 */
function shapeFailures(ledger) {
  const failures = [];
  for (const [key, { kind, why }] of ledger) {
    if (kind !== "grandfathered") {
      failures.push(`${key}: ${LEDGER_PATH} holds only "grandfathered" entries — a failing test cannot be "${kind}"`);
    } else if (!isArgument(why)) {
      failures.push(`${key}: its "why" in ${LEDGER_PATH} must name the cause (≥ 40 characters), not label it`);
    }
  }
  return failures;
}

/** A story is flaky OR broken: on both lists, one of them is lying. */
function doubleListed(ledger, scope, quarantine) {
  return [...ledger.keys()]
    .filter((key) => scope.has(key) && quarantine.active.some((e) => matches(e, key, scope.get(key).spec)))
    .map((key) => `${key} is in ${LEDGER_PATH} AND flaky-quarantine.json — broken or flaky, pick one`);
}

/**
 * Shrink-only against origin/main: the ledger may not grow, and may not list
 * a story main does not — otherwise fixing one story buys a slot for a new
 * failure at the same count.
 */
function ratchetFailures(ledger, base) {
  if (base.unreachable) {
    return [`origin/main could not be read — the shrink-only check cannot run, and a gate that silently ` +
      `skips its ratchet is not a gate. Fetch main (git fetch origin main) and re-run.`];
  }
  if (base.firstRun) return [];
  const failures = [];
  if (ledger.size > base.keys.size) {
    failures.push(`${LEDGER_PATH} lists ${ledger.size} stories, origin/main lists ${base.keys.size} — the ledger only shrinks`);
  }
  for (const key of ledger.keys()) {
    if (!base.keys.has(key)) failures.push(`${key} is new to ${LEDGER_PATH} (origin/main does not list it) — fix the story instead`);
  }
  return failures;
}

function unlistedMessage(scope, outcomes) {
  return (key) => {
    const { id, spec } = scope.get(key);
    return `FAILED: ${key} [${id}] (${spec}) is not in ${LEDGER_PATH} — fix the story:\n        ` +
      excerpt(outcomes.get(key)?.message);
  };
}

/**
 * The whole decision. `base` is `{ keys: Set }`, `{ firstRun: true }` (main
 * has no ledger yet) or `{ unreachable: true }` (main could not be read).
 */
export function evaluate({ index, results, ledger, quarantine, today, base }) {
  const scope = scopeFromIndex(index);
  const { outcomes, suiteErrors } = readResults(results);
  const split = splitQuarantine(quarantine, today);
  const failed = [...outcomes].filter(([k, o]) => o.status === "failed" && scope.has(k)).map(([k]) => k);
  const { findings, quarantined, expiredHits } = applyQuarantine(failed, scope, split);
  const listed = checkLedger({
    findings, ledger, ledgerPath: LEDGER_PATH, unlisted: unlistedMessage(scope, outcomes),
  });
  const failures = [
    ...coverageFailures(scope, outcomes, suiteErrors),
    ...listed.failures,
    ...shapeFailures(ledger),
    ...doubleListed(ledger, scope, split),
    ...ratchetFailures(ledger, base),
  ];
  const passed = [...outcomes.values()].filter((o) => o.status === "passed").length;
  return {
    failures,
    notes: [...quarantined, ...expiredHits],
    stats: { ran: outcomes.size, passed, failed: failed.length, listed: ledger.size, quarantined: quarantined.length },
  };
}
