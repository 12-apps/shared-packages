// The host-brand gate: no file in this repository may name the origin host.
//
// This repo's packages were extracted from one application, and its name kept
// leaking back in — docstrings crediting the port's source, ADOPTING tables,
// migration comments, fixture emails, even an exported constant carrying the
// host's own publisher list. Each package that noticed grew its own tarball
// sweep (`no-host-brand.test.ts`, `packed-artifact.test.ts`, portability
// suites), which protects what npm uploads but not what the repo says: a
// comment in a test, a harness page or a workflow file is outside every
// per-package gate. This script is the repo-wide half: every tracked file,
// no allowlist, exit 1 on the first mention.
//
// NO ALLOWLIST is the load-bearing property. The per-package ban lists need
// the brand words to hunt them, so they build their patterns from SPLIT parts
// (`'future' + 'pay'` — see e.g. `packages/audit/src/__tests__/
// foreign-vocabulary.ts`), and this file does the same. An allowlist would
// have to be burned down forever; split literals need nothing.
//
// Scope is the BRAND only, shaped so ordinary English survives: the plural
// phrase "<A> <B>ments" and "in the future, pay attention" are not offences.
// The domain-noun sweeps (mesa, comanda, R$ …) stay per-package, where the
// package's own vocabulary decides what is foreign.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The name, split so this gate is not its own first hit.
const A = "future";
const B = "pay";

/** Every spelling the repo has actually shipped, each with its own reason. */
const BANS = [
  {
    // The joined spellings: hyphenated, dotted, snake_case, SCREAMING_SNAKE,
    // camelCase and fully fused. No space alternative here, so the ordinary
    // English "<A> <B>ments" (plural) never fires; no trailing \b, so the
    // SCREAMING_SNAKE identifier prefixes and camelCase store keys still do.
    label: `${A}?${B} (joined)`,
    pattern: new RegExp(`${A}[._-]?${B}`, "i"),
  },
  {
    // The spaced brand name, bounded on both sides so "<A> <B>ments" is clean.
    label: `${A} ${B} (spaced)`,
    pattern: new RegExp(`\\b${A} ${B}\\b`, "i"),
  },
];

/**
 * The gate proves it can fire before claiming the tree is clean — a sweep
 * whose patterns rotted matches nothing and reads exactly like success.
 */
function selftest() {
  const mustCatch = [
    `${A}-${B}`,
    `${A}_${B}_AUDIT_VOCABULARY`.toUpperCase(),
    `__${A}${B[0].toUpperCase()}${B.slice(1)}Store`,
    `${A}${B}.checkout.hostedOrder`,
    `o ${A[0].toUpperCase()}${A.slice(1)} ${B[0].toUpperCase()}${B.slice(1)} confirma`,
  ];
  const mustPass = [
    `${A} ${B}ments are retried nightly`,
    "in the future, pay attention to the lease",
    "the payment provider of the future",
  ];
  for (const sample of mustCatch) {
    if (!BANS.some(({ pattern }) => pattern.test(sample))) {
      console.error(`host-brand-gate selftest: pattern failed to catch ${JSON.stringify(sample)}`);
      process.exit(1);
    }
  }
  for (const sample of mustPass) {
    const hit = BANS.find(({ pattern }) => pattern.test(sample));
    if (hit) {
      console.error(
        `host-brand-gate selftest: "${hit.label}" false-fires on ${JSON.stringify(sample)}`,
      );
      process.exit(1);
    }
  }
}

/** Tracked files only: `git ls-files` already excludes node_modules and dist. */
function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function sweep() {
  const offences = [];
  for (const file of trackedFiles()) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted in the working tree, or unreadable — nothing to say
    }
    if (text.includes("\0")) continue; // binary
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const hit = BANS.find(({ pattern }) => pattern.test(lines[i]));
      if (hit) offences.push(`${file}:${i + 1} — ${hit.label}`);
    }
  }
  return offences;
}

selftest();
const offences = sweep();
if (offences.length > 0) {
  console.error(`host-brand-gate: ${offences.length} mention(s) of the origin host's name:\n`);
  for (const offence of offences) console.error(`  ${offence}`);
  console.error(
    "\nA shared package (or this repo's harness, docs and CI) must not name the " +
      "application it was extracted from — not in exports, not in defaults, not in " +
      "docstrings. Describe the host generically ('the origin host', 'one adopter') " +
      "or move the host-specific artifact into the host's own repository.",
  );
  process.exit(1);
}
console.log("host-brand-gate: clean — no tracked file names the origin host.");
