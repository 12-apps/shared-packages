// Selftest for the wiring conformance core (scripts/lib/wiring-estate.mjs).
//
// The two things that must never rot silently: the capability vocabulary
// (pinned against the CONTRACT's own source, so a new kind breaks here the
// day it lands) and the manifest source scan (pinned against fixtures of the
// exact stylized shapes the estate writes, so a style drift breaks here
// instead of quietly declaring nothing). Everything else is the rule set —
// each case is one way a package could look wired without being wired.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CAPABILITIES,
  DATA_CAPABILITIES,
  SERVER_CAPABILITIES,
  WEB_CAPABILITIES,
  contractCapabilities,
  declaredCapabilities,
  evaluatePackage,
  findingPackage,
  runtimeWiringImports,
  distinctWhyFailures,
  shrinkFailures,
  touchMustFixFailures,
} from "./lib/wiring-estate.mjs";

const LABEL = "[wiring-conformance]";

const contract = contractCapabilities(
  readFileSync("packages/wiring/src/contract/manifest.ts", "utf8"),
);

const MULTI_MANIFEST = `
export const oneManifest = {
  name: '@12-apps/fixture',
  contract: 1,
  db: { partial: 'prisma/fixture.prisma', migrations: 'prisma/migrations' },
  e2e: {
    entry: '@12-apps/fixture/e2e',
    world: { factory: 'defineFixtureWorld' },
  },
  observability: { namespace: 'fixture' },
  server: ['http', 'jobs'],
} as const satisfies PackageManifest;

export const twoManifest = {
  name: '@12-apps/fixture-platform',
  contract: 1,
  observability: { namespace: 'fixture-platform' },
  server: ["http", "email"],
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
`;

/** A minimal producer package.json the cases below mutate per rule. */
function producer(overrides = {}) {
  return {
    name: "@12-apps/fixture",
    exports: { "./manifest": "./src/manifest/index.ts", "./manifest/server": "./src/manifest/server.ts" },
    wiring: { db: { partial: "prisma/fixture.prisma" } },
    devDependencies: { "@12-apps/wiring": "workspace:*" },
    peerDependencies: { "@12-apps/wiring": ">=1.3.0" },
    peerDependenciesMeta: { "@12-apps/wiring": { optional: true } },
    ...overrides,
  };
}

const HAPPY_SOURCE = "  db: { partial: 'x' },\n  observability: { namespace: 'x' },\n  server: ['http'],\n";

function failuresOf(packageJson, indexSource = HAPPY_SOURCE) {
  return evaluatePackage({ name: packageJson.name, packageJson, indexSource }).failures;
}

const ledger = (entries) => new Map(Object.entries(entries));

const cases = [
  // --- the vocabulary is the contract's, not this gate's ------------------
  [
    () => contract.server.join(",") === SERVER_CAPABILITIES.join(","),
    "server kinds match ServerCapabilityKind in the contract source",
  ],
  [
    () => contract.web.join(",") === WEB_CAPABILITIES.join(","),
    "web kinds match WebCapabilityKind in the contract source",
  ],
  [
    () => contract.data.join(",") === DATA_CAPABILITIES.join(","),
    "data capabilities match PackageManifest's optional keys",
  ],
  [() => CAPABILITIES.length >= 10, "the answered surface stays the full 10+ kind set"],

  // --- the source scan reads what the estate actually writes --------------
  [
    () => {
      const declared = declaredCapabilities(MULTI_MANIFEST);
      const expected = ["db", "e2e", "observability", "http", "jobs", "email", "surface", "areas"];
      return expected.every((kind) => declared.has(kind)) && !declared.has("permissions");
    },
    "a multi-manifest module declares the UNION of its data keys and inventories",
  ],
  [
    () => !declaredCapabilities("    db: 'nested inside some other literal',\n").has("db"),
    "a nested key at deeper indent is not a manifest declaration",
  ],

  // --- the dependency edge stays type-only --------------------------------
  [
    () => runtimeWiringImports(`import { defineManifest } from "@12-apps/wiring/producer";\n`).length === 1,
    "a runtime value import of the producer is caught",
  ],
  [
    () => runtimeWiringImports(`import type { PackageManifest } from '@12-apps/wiring';\n`).length === 0,
    "a type-only import is the sanctioned edge",
  ],
  [
    () => runtimeWiringImports(`import { type A, type B } from "@12-apps/wiring";\n`).length === 0,
    "inline type-only specifiers are sanctioned too",
  ],
  [
    () => runtimeWiringImports(`import { type A, defineManifest } from "@12-apps/wiring/producer";\n`).length === 1,
    "one value specifier among inline types is still a runtime import",
  ],
  [
    () => runtimeWiringImports(`import type {\n  A,\n} from "@12-apps/wiring";\n`).length === 0,
    "a multi-line type import's closing line is not a false positive",
  ],
  [
    () => runtimeWiringImports(`import {\n  wireEndpoint,\n} from "@12-apps/wiring/consumer";\n`).length === 1,
    "a multi-line VALUE import is still caught through its opening line",
  ],

  // --- structure around a declaration -------------------------------------
  [() => failuresOf(producer()).length === 0, "the happy producer passes every structural rule"],
  [
    () => failuresOf(producer({ exports: { "./manifest": "./src/manifest/index.ts" } })).some((f) => f.includes('"./manifest/server"')),
    "an inventoried server runtime without its subpath fails",
  ],
  [
    () => failuresOf(producer(), "  observability: { namespace: 'x' },\n").some((f) => f.includes("dead subpath")),
    "a server subpath nothing inventories fails as drift",
  ],
  [
    () => failuresOf(producer({ wiring: undefined }), HAPPY_SOURCE).some((f) => f.includes("wiring.db")),
    "a declared db without its package.json mirror fails",
  ],
  [
    () =>
      failuresOf(producer({ wiring: { db: {}, env: [] } })).some((f) => f.includes("stale mirror")),
    "a mirrored key nothing declares fails as stale",
  ],
  [
    () =>
      failuresOf(producer({ dependencies: { "@12-apps/wiring": "workspace:*" } })).some((f) =>
        f.includes("runtime dependency"),
      ),
    "the contract as a runtime dependency fails",
  ],
  [
    () => failuresOf(producer({ peerDependenciesMeta: {} })).some((f) => f.includes("optional")),
    "a required peer fails until peerDependenciesMeta marks it optional",
  ],

  // --- findings: every kind is answered or listed --------------------------
  [
    () => {
      const { findings } = evaluatePackage({ name: "@12-apps/fixture", packageJson: producer(), indexSource: HAPPY_SOURCE });
      return findings.length === CAPABILITIES.length - 3 && findings.includes("@12-apps/fixture :: surface");
    },
    "a producer's findings enumerate exactly its undeclared kinds",
  ],
  [
    () => {
      const { findings } = evaluatePackage({ name: "@12-apps/lib", packageJson: { name: "@12-apps/lib" }, indexSource: "" });
      return findings.length === 1 && findings[0] === "@12-apps/lib";
    },
    "a package with no manifest is one finding: its name, for the ledger to argue",
  ],
  [
    () => findingPackage("@12-apps/rbac :: notifications") === "@12-apps/rbac" && findingPackage("@12-apps/ui") === "@12-apps/ui",
    "a finding key maps back to its package name",
  ],

  // --- the ratchet ---------------------------------------------------------
  [
    () =>
      shrinkFailures({
        baseLedger: ledger({}),
        headLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        ledgerPath: ".x.json",
      }).length === 1,
    "a newly grandfathered entry fails — the pending set may only shrink",
  ],
  [
    () =>
      shrinkFailures({
        baseLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        headLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        ledgerPath: ".x.json",
      }).length === 0,
    "debt that merely persists is the burn-down's business, not the shrink rule's",
  ],
  [
    () =>
      shrinkFailures({
        baseLedger: null,
        headLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        ledgerPath: ".x.json",
      }).length === 0,
    "no base ledger yet means nothing to shrink from (the gate's own first PR)",
  ],
  [
    () =>
      touchMustFixFailures({
        changedFiles: ["packages/x/src/server/index.ts"],
        headLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        dirByName: new Map([["@12-apps/x", "packages/x"]]),
        ledgerPath: ".x.json",
      }).length === 1,
    "touching a package with pending entries obliges the same PR to clear them",
  ],
  [
    () =>
      touchMustFixFailures({
        changedFiles: ["packages/y/src/index.ts", "README.md"],
        headLedger: ledger({ "@12-apps/x :: jobs": { kind: "grandfathered", why: "later" } }),
        dirByName: new Map([["@12-apps/x", "packages/x"]]),
        ledgerPath: ".x.json",
      }).length === 0,
    "debt in a package the diff never touches waits for its own PR",
  ],
  [
    () =>
      touchMustFixFailures({
        changedFiles: ["packages/x/src/server/index.ts"],
        headLedger: ledger({ "@12-apps/x :: db": { kind: "exempt", why: "argued at length elsewhere in this ledger" } }),
        dirByName: new Map([["@12-apps/x", "packages/x"]]),
        ledgerPath: ".x.json",
      }).length === 0,
    "an argued exemption is settled — touching the package does not reopen it",
  ],
  [
    () =>
      distinctWhyFailures({
        ledger: ledger({
          "@12-apps/x :: jobs": { kind: "exempt", why: "this package is a thin client and owns none of that" },
          "@12-apps/x :: email": { kind: "exempt", why: "this package is a thin client and owns none of that" },
        }),
        ledgerPath: ".x.json",
      }).length === 1,
    "one sentence answering two capabilities in a package is refused",
  ],
  [
    () =>
      distinctWhyFailures({
        ledger: ledger({
          "@12-apps/x :: jobs": { kind: "exempt", why: "nothing here runs on a cadence, so a blueprint would schedule nothing" },
          "@12-apps/x :: email": { kind: "exempt", why: "no user-reaching moment starts here, so a mailer would invent one" },
        }),
        ledgerPath: ".x.json",
      }).length === 0,
    "two capabilities argued on their own terms pass",
  ],
  [
    () =>
      distinctWhyFailures({
        ledger: ledger({
          "@12-apps/x :: jobs": { kind: "exempt", why: "this package is a thin client and owns none of that" },
          "@12-apps/y :: jobs": { kind: "exempt", why: "this package is a thin client and owns none of that" },
        }),
        ledgerPath: ".x.json",
      }).length === 0,
    "the SAME argument across two packages stays legal — one fact about both",
  ],
  [
    () =>
      distinctWhyFailures({
        ledger: ledger({
          "@12-apps/x :: jobs": { kind: "exempt", why: "this package is a thin client\n  and owns none of that" },
          "@12-apps/x :: email": { kind: "exempt", why: "This package is a thin client and owns none of that" },
        }),
        ledgerPath: ".x.json",
      }).length === 1,
    "a re-wrap and a capitalised first letter do not buy a second copy",
  ],
];

function main() {
  const failed = cases.filter(([assertion]) => {
    try {
      return !assertion();
    } catch {
      return true;
    }
  });
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  if (failed.length > 0) process.exit(1);
  console.log(`${LABEL} ${cases.length} case(s) pass.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
