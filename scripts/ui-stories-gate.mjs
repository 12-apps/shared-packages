// The ui-stories gate: `@12-apps/ui`'s WEB story play functions, run in CI
// (FUT-2619).
//
// ## Why
//
// The browser-level tests of the design system are Storybook play functions in
// `*.test.stories.tsx` — the only tier that can measure layout, since the unit
// tests run in jsdom. The Native lane drives the SHARED stories through
// react-native-web; nothing drove the web ones, so every web-only story (a
// component with no native port, or a `native-skip` story) ran only when
// somebody typed `pnpm --filter @12-apps/ui test:ci`, and rotted unseen.
//
// ## What runs
//
// The served web Storybook (`packages/ui/storybook-static`, built by the step
// before this one) under `concurrently -k -s first`, the sequencing `test:ci`
// and the Native lane use so the runner never races the server:
//
//   test-storybook --index-json --includeTags test … '/[^/]+-tests\.test\.js$'
//
// The positional pattern is what narrows the run to the test suites.
// `--includeTags test` alone selects EVERY story: Storybook gives each one the
// default tags `dev` and `test`, so it would also smoke-render the ~1,660
// non-test stories. Every `*.test.stories.tsx` title ends in `/Tests` and no
// other title does, so the runner's per-title file `<title-id>.test.js` ends
// in `-tests.test.js` exactly for them. The tag stays so a `!test` story is
// excluded by the runner — and then fails here as "did not run", because the
// gate checks the results cover the index's test stories EXACTLY.
//
// ## What fails — `scripts/lib/ui-stories-evaluate.mjs`
//
//   - a failing story that is not on the ledger, named in the log as
//     `FAILED: <title> › <story> [<id>] (<file>)` with the first lines of its error;
//   - a ledger entry whose story now passes (stale — delete it);
//   - a ledger that grew, or lists a story origin/main does not;
//   - an entry that is not `grandfathered` with a written `why` (≥ 40 chars);
//   - a test story that produced no result, or a result from outside the scope;
//   - no results at all (the server never came up, or the runner crashed).
//
// A story that fails INTERMITTENTLY belongs in `flaky-quarantine.json`
// (ticketed, dated), never on the ledger: an active entry whose `spec` is the
// story's source file and whose `titlePattern` matches `"<title> › <story>"`
// has its result ignored; once `expiresAt` passes, it counts again.
//
// ## Usage
//
//   pnpm quality:ui-stories                        # selftest, then run + judge
//   node scripts/ui-stories-gate.mjs --results f   # judge an existing Jest JSON
//
// Locally, a Chromium that is not the build Playwright expects is reached with
// STORYBOOK_CHROMIUM_PATH (packages/ui/test-runner-jest.config.cjs), and
// UI_STORIES_PORT moves the server off 6008 when something else holds it, and
// UI_STORIES_MAX_WORKERS lowers the parallelism on a busy machine.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger } from "./lib/exception-ledger.mjs";
import { evaluate, LEDGER_PATH } from "./lib/ui-stories-evaluate.mjs";

const LABEL = "[ui-stories]";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "packages/ui");
const INDEX = join(UI, "storybook-static/index.json");
const RESULTS = join(UI, "test-results/ui-stories.json");
const SELECT = "'/[^/]+-tests\\.test\\.js$'";
// `storybook:serve`'s port, overridable for a machine where something else
// already holds it. A server that cannot bind exits first, and `-k -s first`
// then kills the runner before it writes results — so an occupied port is a
// red "no results", never a run against somebody else's Storybook.
const PORT = process.env.UI_STORIES_PORT ?? "6008";
// CI's runner has 4 cores. A loaded local machine crashes Chromium pages at 4
// (`Target crashed`, `page.goto: Page crashed`), which read as story failures.
const WORKERS = process.env.UI_STORIES_MAX_WORKERS ?? "4";

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (args) => { try { return git(args); } catch { return null; } };
const hasMain = () => tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]) !== null;

/** origin/main's ledger keys; see `evaluate` for the three shapes. */
function readBase() {
  if (!hasMain()) tryGit(["fetch", "--no-tags", "--depth=1", "origin", "main:refs/remotes/origin/main"]);
  if (!hasMain()) return { unreachable: true };
  const raw = tryGit(["show", `origin/main:${LEDGER_PATH}`]);
  if (raw === null) return { firstRun: true };
  return { keys: new Set(Object.keys(JSON.parse(raw))) };
}

/** Serve the built Storybook and run the test suites; the Jest JSON lands in RESULTS. */
function runStories() {
  if (!existsSync(INDEX)) {
    console.error(`${LABEL} ${INDEX} is missing — build the Storybook first:\n` +
      `  pnpm exec turbo run build --filter=@12-apps/ui && pnpm --filter @12-apps/ui storybook:build`);
    process.exit(1);
  }
  rmSync(RESULTS, { force: true });
  mkdirSync(dirname(RESULTS), { recursive: true });
  // Order matters: test-storybook declares `--outputFile` as a FLAG and hands
  // everything it does not know to Jest in order, so the path has to come
  // straight after it and before the positional pattern.
  const test = `test-storybook --index-json --includeTags test --maxWorkers=${WORKERS} --url http://localhost:${PORT} ` +
    `--json --outputFile ${RESULTS} ${SELECT}`;
  const run = spawnSync(
    "pnpm",
    ["exec", "concurrently", "-k", "-s", "first", "-n", "serve,test", "-c", "bgBlue.bold,bgGreen.bold", `http-server storybook-static -p ${PORT} --silent`, test],
    { cwd: UI, stdio: "inherit" },
  );
  // The runner's exit code is not the verdict — a listed or quarantined story
  // fails it too. The verdict is `evaluate` over the JSON; no JSON is a failure.
  if (!existsSync(RESULTS)) {
    console.error(`${LABEL} the runner wrote no results (exit ${run.status}) — the server did not come up or ` +
      `test-storybook crashed; its output is above.`);
    process.exit(1);
  }
  return RESULTS;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const i = process.argv.indexOf("--results");
  const resultsPath = i === -1 ? runStories() : resolve(process.argv[i + 1]);
  const { failures, notes, stats } = evaluate({
    index: readJson(INDEX),
    results: readJson(resultsPath),
    ledger: readLedger(join(ROOT, LEDGER_PATH), { existsSync, readFileSync }),
    quarantine: readJson(join(ROOT, "flaky-quarantine.json")),
    today: new Date().toISOString().slice(0, 10),
    base: readBase(),
  });
  for (const note of notes) console.log(`${LABEL} note: ${note}`);
  const tally = `${stats.ran} test stories ran: ${stats.passed} passed, ${stats.failed} failed ` +
    `(${stats.listed} on ${LEDGER_PATH}, ${stats.quarantined} quarantined)`;
  if (failures.length > 0) {
    console.error(`${LABEL} ${tally}. ${failures.length} failure(s):\n\n${failures.map((f) => `  - ${f}`).join("\n\n")}`);
    process.exit(1);
  }
  console.log(`${LABEL} clean — ${tally}; the ledger only shrinks.`);
}

main();
