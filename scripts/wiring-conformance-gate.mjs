// The wiring conformance gate: every workspace package answers for every
// capability kind the contract names, or CI is red.
//
// WHAT COUNTS AS ANSWERED. A capability is declared by the package's shared
// manifest (data key, or a kind its `server:` / `web:` inventory lists), or
// it has an entry in `.wiring-conformance.json`: `exempt` with a written
// argument (the manifest docblocks' narrowings, made machine-readable), or
// `grandfathered` (debt). A package with no `./manifest` export at all is one
// finding — its NAME — which a library answers with an argued exemption and
// a wireable seam cannot answer at all without becoming debt.
//
// AROUND EVERY DECLARATION, structure nobody may excuse: the subpath exists
// for each inventoried runtime (and does not exist for a runtime nothing
// inventories), `db`/`env` are mirrored into package.json where assemblers
// read them, the contract stays a type-only devDependency with an OPTIONAL
// peer, and no shipped source imports `@12-apps/wiring` at runtime.
//
// THE RATCHET. `grandfathered` may only shrink (against the merge base), and
// touching a package that still carries grandfathered entries obliges the
// same PR to clear them — `.payments-surface.json`'s rules, applied to the
// wiring contract. Both rules read the base ledger out of git; a lane with
// no reachable base fails rather than silently skipping while debt exists.
//
// Runs from `ci-success` (which no paths filter can skip) and from
// `pnpm quality:wiring`. Plain node, no install. `--findings` prints the
// current finding set, which is how the ledger is authored in the first
// place.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { checkLedger, readLedger, summarize } from "./lib/exception-ledger.mjs";
import { inScope } from "./lib/shipped-source.mjs";
import {
  CAPABILITIES,
  DATA_CAPABILITIES,
  SERVER_CAPABILITIES,
  WEB_CAPABILITIES,
  contractCapabilities,
  evaluatePackage,
  runtimeWiringImports,
  distinctWhyFailures,
  shrinkFailures,
  touchMustFixFailures,
} from "./lib/wiring-estate.mjs";

const LABEL = "[wiring-conformance]";
const LEDGER_PATH = ".wiring-conformance.json";
const CONTRACT_SOURCE = "packages/wiring/src/contract/manifest.ts";
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

/** The workspace's own package globs, read from pnpm-workspace.yaml. */
function workspaceDirs() {
  const yaml = readFileSync("pnpm-workspace.yaml", "utf8");
  const section = yaml.match(/^packages:\n((?: {2}- "[^"]+"\n)+)/m);
  if (!section) throw new Error(`${LABEL} could not read the packages list from pnpm-workspace.yaml`);
  const parents = [...section[1].matchAll(/- "([^"]+)"/g)].map(([, glob]) => {
    const parent = glob.replace(/\/\*$/, "");
    if (parent === glob) throw new Error(`${LABEL} unsupported workspace glob: ${glob}`);
    return parent;
  });
  const dirs = parents.flatMap((parent) =>
    readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, "package.json")))
      .map((entry) => join(parent, entry.name)),
  );
  return [...new Set(dirs)];
}

/**
 * Resolve an export-map target to a readable SOURCE path, or null. The estate
 * writes two conventions — some packages export `./src/manifest/index.ts`
 * directly, the built ones export `./dist/manifest/index.js` — and a fresh
 * checkout has no dist, so a dist target falls back to its `src/**` twin.
 */
function exportTarget(dir, exportsMap, subpath) {
  const value = exportsMap?.[subpath];
  const target =
    typeof value === "string"
      ? value
      : (value && (value.import ?? value.default ?? Object.values(value)[0])) || null;
  if (typeof target !== "string") return null;
  const candidate = sourceCandidates(target)
    .map((relative) => join(dir, relative))
    .find((path) => existsSync(path));
  return candidate ?? null;
}

/** A dist target's readable twins — a fresh checkout has src, never dist. */
function sourceCandidates(target) {
  if (!target.includes("/dist/")) return [target];
  const source = target.replace("/dist/", "/src/");
  return [target, source.replace(/\.js$/, ".ts"), source.replace(/\.js$/, ".tsx")];
}

/** Every shipped source file under `dir/src`, repo-relative. */
function shippedSources(dir) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SOURCE_EXT.test(entry.name) && inScope(path)) found.push(path);
    }
  };
  if (existsSync(join(dir, "src"))) walk(join(dir, "src"));
  return found;
}

/** Fail loudly if the contract's own vocabulary drifted from this gate's. */
function assertContractVocabulary(failures) {
  const kinds = contractCapabilities(readFileSync(CONTRACT_SOURCE, "utf8"));
  const pairs = [
    [kinds.server, SERVER_CAPABILITIES, "server"],
    [kinds.web, WEB_CAPABILITIES, "web"],
    [kinds.data, DATA_CAPABILITIES, "data"],
  ];
  for (const [contract, mirrored, label] of pairs) {
    if (contract.join(",") !== mirrored.join(",")) {
      failures.push(
        `the contract's ${label} capabilities (${contract.join(", ") || "none read"}) drifted from ` +
          `this gate's (${mirrored.join(", ")}) — update scripts/lib/wiring-estate.mjs, and the ` +
          `ledger entries the new kind obliges, in the same PR as the contract change`,
      );
    }
  }
}

function scanPackage(dir, failures, findings, dirByName) {
  const packageJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (packageJson.name === "@12-apps/wiring") return;
  dirByName.set(packageJson.name, dir);
  const indexPath = exportTarget(dir, packageJson.exports, "./manifest");
  const evaluated = evaluatePackage({
    name: packageJson.name,
    packageJson,
    indexSource: indexPath ? readFileSync(indexPath, "utf8") : packageJson.exports?.["./manifest"] ? null : "",
  });
  failures.push(...evaluated.failures);
  for (const finding of evaluated.findings) findings.add(finding);
  for (const path of shippedSources(dir)) {
    const hits = runtimeWiringImports(readFileSync(path, "utf8"));
    failures.push(
      ...hits.map((hit) => `${packageJson.name}: runtime import of the contract at ${path}:${hit}`),
    );
  }
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The shrink-only + touch-must-fix pair, held against the merge base. */
function ratchetFailures(headLedger) {
  const baseRef =
    process.env.WIRING_BASE_REF ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  const mergeBase = git("merge-base", "HEAD", baseRef);
  const pending = [...headLedger.values()].filter((entry) => entry.kind === "grandfathered").length;
  if (!mergeBase) {
    if (pending === 0) return [];
    return [
      `cannot resolve a merge base against ${baseRef} while ${pending} grandfathered ` +
        `entr(y/ies) exist — fetch the base branch (the ratchet must not be skippable)`,
    ];
  }
  const baseRaw = git("show", `${mergeBase}:${LEDGER_PATH}`);
  const baseLedger =
    baseRaw === null
      ? null
      : new Map(Object.entries(JSON.parse(baseRaw)).map(([k, v]) => [k, typeof v === "string" ? { kind: "grandfathered", why: v } : v]));
  const changedFiles = (git("diff", "--name-only", mergeBase) ?? "").split("\n").filter(Boolean);
  return [
    ...shrinkFailures({ baseLedger, headLedger, ledgerPath: LEDGER_PATH }),
    ...touchMustFixFailures({ changedFiles, headLedger, dirByName: DIR_BY_NAME, ledgerPath: LEDGER_PATH }),
  ];
}

const DIR_BY_NAME = new Map();

function main() {
  const failures = [];
  const findings = new Set();
  assertContractVocabulary(failures);
  for (const dir of workspaceDirs()) scanPackage(dir, failures, findings, DIR_BY_NAME);

  if (process.argv.includes("--findings")) {
    for (const finding of [...findings].sort()) console.log(finding);
    return;
  }

  const ledger = readLedger(LEDGER_PATH, { existsSync, readFileSync });
  const checked = checkLedger({
    findings,
    ledger,
    ledgerPath: LEDGER_PATH,
    unlisted: (finding) =>
      finding.includes(" :: ")
        ? `${finding} is unanswered — declare it in the manifest, or argue an "exempt" entry ` +
          `in ${LEDGER_PATH} (a narrowing is written down or it does not exist)`
        : `${finding} ships no "./manifest" — a wireable package declares one, a library gets ` +
          `an argued "exempt" entry in ${LEDGER_PATH}`,
  });
  failures.push(
    ...checked.failures,
    ...ratchetFailures(ledger),
    ...distinctWhyFailures({ ledger, ledgerPath: LEDGER_PATH }),
  );

  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    summarize({
      label: LABEL,
      total: findings.size,
      noun: `answered capability gap(s) across ${DIR_BY_NAME.size} package(s), ${CAPABILITIES.length} kinds each`,
      counts: checked.counts,
      burndown: "touching a package with pending entries obliges that PR to clear them",
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
