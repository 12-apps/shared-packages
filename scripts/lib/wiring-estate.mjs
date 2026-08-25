// The pure half of the wiring conformance gate: what "completely wired" means
// for one package, computed from inputs the caller reads (sources, export
// maps, ledgers, diffs) so every rule here is testable without a filesystem —
// the same injection posture as `exception-ledger.mjs` one file over.
//
// THE PROPERTY THE GATE HOLDS. `@12-apps/wiring` names twelve capability
// kinds. For every workspace package, every one of the twelve is ANSWERED:
// declared by its manifest (and then the structure around the declaration —
// subpaths, mirrors, the dependency edge — must hold), or argued away in the
// conformance ledger with a written reason, or listed as `grandfathered`
// debt. Debt may only shrink, and touching a package with debt obliges the
// same PR to clear it — the `.payments-surface.json` rules, applied to the
// wiring contract itself.
//
// WHY A SOURCE SCAN AND NOT AN IMPORT. Gates in this repo are plain node
// (they run in lanes with no install, and `ci-success` cannot be skipped by
// a paths filter), and the manifests are TypeScript. The scan reads the two
// stylized shapes every manifest in the estate uses — a capability key at
// two-space depth, a `server:`/`web:` inventory array — and the selftest
// pins the extraction so a style drift breaks loudly here, not silently in
// a host. The heavy validation (shapes, inventory drift, mirrors byte-for-
// byte) stays where it lives today: each package's own manifest suite.

/** Server-runtime capability kinds, mirrored from `ServerCapabilityKind`. */
export const SERVER_CAPABILITIES = ["http", "jobs", "email"];

/** Web-runtime capability kinds, mirrored from `WebCapabilityKind`. */
export const WEB_CAPABILITIES = ["surface", "areas"];

/** Data capabilities: the optional keys of `PackageManifest` itself. */
export const DATA_CAPABILITIES = [
  "permissions",
  "notifications",
  "mcp",
  "db",
  "e2e",
  "env",
  "observability",
];

/** Every kind a package must answer for, in report order. */
export const CAPABILITIES = [...SERVER_CAPABILITIES, ...WEB_CAPABILITIES, ...DATA_CAPABILITIES];

/** `PackageManifest` keys that are identity or inventory, never capabilities. */
const NON_CAPABILITY_KEYS = new Set(["name", "contract", "server", "web"]);

const QUOTED = /"([a-z]+)"|'([a-z]+)'/g;

/** Every quoted lowercase word in `text`, in order. */
function quotedWords(text) {
  const words = [];
  for (const match of text.matchAll(QUOTED)) words.push(match[1] ?? match[2]);
  return words;
}

/**
 * Read the capability vocabulary out of the CONTRACT's own source
 * (`packages/wiring/src/contract/manifest.ts`), so the constants above are
 * pinned against the package that owns them. A new kind lands there first;
 * the selftest comparing this extraction to the constants is what makes the
 * gate fail loudly instead of quietly not checking the new kind.
 */
export function contractCapabilities(manifestTsSource) {
  const union = (name) => {
    const match = manifestTsSource.match(new RegExp(`export type ${name} =([^;]+);`));
    return match ? quotedWords(match[1]) : [];
  };
  const block = manifestTsSource.match(/export interface PackageManifest \{([\s\S]*?)\n\}/);
  const data = [];
  for (const match of (block?.[1] ?? "").matchAll(/readonly (\w+)\??:/g)) {
    if (!NON_CAPABILITY_KEYS.has(match[1])) data.push(match[1]);
  }
  return { server: union("ServerCapabilityKind"), web: union("WebCapabilityKind"), data };
}

const DATA_KEY_RE = new RegExp(`^ {2}(${DATA_CAPABILITIES.join("|")}) *:`, "gm");
const INVENTORY_RE = /^ {2}(server|web) *: *\[([^\]]*)\]/gm;

/**
 * The capability kinds a shared-manifest module declares: its data keys plus
 * everything its `server:` / `web:` inventories list. A module may export
 * several manifests (auth, impersonation and payments-backend each split a
 * surface pair); the package's answer is the UNION, which is why the scan is
 * global over the module rather than scoped to one literal.
 */
export function declaredCapabilities(indexSource) {
  const dataKeys = [...indexSource.matchAll(DATA_KEY_RE)].map((match) => match[1]);
  const inventoried = [...indexSource.matchAll(INVENTORY_RE)].flatMap((match) =>
    quotedWords(match[2]),
  );
  return new Set([...dataKeys, ...inventoried]);
}

/**
 * Lines that IMPORT `@12-apps/wiring` at runtime. Type-only imports are the
 * sanctioned edge (the report-builder move); a value import publishes the
 * contract package as a runtime dependency of the producer — the defect auth
 * carried alone until #443, kept extinct here.
 */
export function runtimeWiringImports(source) {
  const offending = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/from ["']@12-apps\/wiring/.test(line)) continue;
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
    const opener = /\b(import|export)\b/.test(line) ? line : openingStatement(lines, index);
    if (!isTypeOnlyImportLine(opener)) offending.push(`${index + 1}: ${line.trim()}`);
  }
  return offending;
}

/** The `import …` line a multi-line `} from "…"` continuation belongs to. */
function openingStatement(lines, fromIndex) {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    if (/\b(import|export)\b/.test(lines[index])) return lines[index];
  }
  return lines[fromIndex];
}

/** True for `import type …`, `export type …`, and `import { type A, type B }`. */
function isTypeOnlyImportLine(line) {
  if (/^\s*(import|export) type\b/.test(line)) return true;
  const braces = line.match(/^\s*import\s*\{([^}]*)\}\s*from/);
  if (!braces) return false;
  const specifiers = braces[1].split(",").map((part) => part.trim()).filter(Boolean);
  return specifiers.length > 0 && specifiers.every((part) => part.startsWith("type "));
}

/** True when the export map carries the given manifest subpath. */
function hasExport(exportsMap, subpath) {
  return Boolean(exportsMap && Object.hasOwn(exportsMap, subpath));
}

function checkSubpaths({ name, exportsMap, declared, failures }) {
  const wantsServer = SERVER_CAPABILITIES.some((kind) => declared.has(kind));
  const wantsWeb = WEB_CAPABILITIES.some((kind) => declared.has(kind));
  const rules = [
    [wantsServer, "./manifest/server", "its inventory names server capabilities"],
    [wantsWeb, "./manifest/web", "its inventory names web capabilities"],
  ];
  for (const [wanted, subpath, why] of rules) {
    if (wanted && !hasExport(exportsMap, subpath)) {
      failures.push(`${name}: ${why} but the export map has no "${subpath}"`);
    }
    if (!wanted && hasExport(exportsMap, subpath)) {
      failures.push(
        `${name}: exports "${subpath}" but no manifest inventories that runtime — ` +
          `dead subpath or missing inventory`,
      );
    }
  }
}

function checkMirrors({ name, wiringMirror, declared, failures }) {
  for (const key of ["db", "env"]) {
    const inManifest = declared.has(key);
    const inMirror = Boolean(wiringMirror && Object.hasOwn(wiringMirror, key));
    if (inManifest && !inMirror) {
      failures.push(
        `${name}: manifest declares "${key}" but package.json has no "wiring.${key}" mirror — ` +
          `host assemblers read the mirror, so the declaration is invisible to them`,
      );
    }
    if (!inMirror || inManifest) continue;
    failures.push(
      `${name}: package.json mirrors "wiring.${key}" but no manifest declares it — stale mirror`,
    );
  }
}

function checkDependencyEdge({ name, packageJson, failures }) {
  if (packageJson.dependencies?.["@12-apps/wiring"]) {
    failures.push(
      `${name}: "@12-apps/wiring" is a runtime dependency — the contract is a type-only ` +
        `devDependency plus an optional peer (the report-builder move)`,
    );
  }
  const peer = packageJson.peerDependencies?.["@12-apps/wiring"];
  const optional = packageJson.peerDependenciesMeta?.["@12-apps/wiring"]?.optional === true;
  if (peer && !optional) {
    failures.push(
      `${name}: the "@12-apps/wiring" peer is required — mark it optional in ` +
        `peerDependenciesMeta so hosts that never adopt the contract never install it`,
    );
  }
}

/**
 * Evaluate one package: the FINDINGS the ledger must answer (one per
 * unanswered capability for a producer; the bare package name for a package
 * with no manifest at all) and the structural FAILURES nothing may excuse.
 */
export function evaluatePackage({ name, packageJson, indexSource }) {
  const failures = [];
  const findings = [];
  const exportsMap = packageJson.exports;
  const isProducer = hasExport(exportsMap, "./manifest");

  if (!isProducer) {
    if (packageJson.wiring) failures.push(`${name}: has a "wiring" mirror but no "./manifest" export`);
    findings.push(name);
    return { findings, failures, declared: new Set() };
  }

  const declared = declaredCapabilities(indexSource ?? "");
  if (indexSource === null) {
    failures.push(`${name}: exports "./manifest" but the manifest source could not be read`);
    return { findings, failures, declared };
  }
  checkSubpaths({ name, exportsMap, declared, failures });
  checkMirrors({ name, wiringMirror: packageJson.wiring, declared, failures });
  checkDependencyEdge({ name, packageJson, failures });
  for (const capability of CAPABILITIES) {
    if (!declared.has(capability)) findings.push(`${name} :: ${capability}`);
  }
  return { findings, failures, declared };
}

/** Package name of a finding key (`"@x/y :: db"` and `"@x/y"` both → `"@x/y"`). */
export function findingPackage(finding) {
  return finding.split(" :: ")[0];
}

/**
 * The shrink-only rule: `grandfathered` entries may leave the ledger, never
 * join it. `base` is the ledger at the merge base (null when it did not
 * exist yet — a brand-new gate has nothing to shrink from).
 */
export function shrinkFailures({ baseLedger, headLedger, ledgerPath }) {
  if (!baseLedger) return [];
  const failures = [];
  for (const [finding, entry] of headLedger) {
    if (entry.kind !== "grandfathered") continue;
    if (baseLedger.get(finding)?.kind === "grandfathered") continue;
    failures.push(
      `${ledgerPath} grew: "${finding}" is newly grandfathered — the pending set may only ` +
        `shrink. Declare the capability, or argue an "exempt" entry with a written why.`,
    );
  }
  return failures;
}

/**
 * The touch-must-fix rule: a diff that reaches into a package's directory
 * obliges the same PR to clear that package's `grandfathered` entries — the
 * `.quality-exceptions` doctrine, so debt is paid by whoever is already
 * holding the file open.
 */
export function touchMustFixFailures({ changedFiles, headLedger, dirByName, ledgerPath }) {
  const touched = new Set();
  for (const [finding, entry] of headLedger) {
    if (entry.kind !== "grandfathered") continue;
    const name = findingPackage(finding);
    const dir = dirByName.get(name);
    if (!dir) continue;
    if (changedFiles.some((file) => file.startsWith(`${dir}/`))) touched.add(name);
  }
  return [...touched].map(
    (name) =>
      `touch-must-fix: this change touches ${name}, which still has grandfathered entries in ` +
      `${ledgerPath} — finish its wiring (or argue an "exempt" entry) in the same PR`,
  );
}
