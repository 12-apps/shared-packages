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
// the brand words to hunt them, so they DECODE their patterns from base64 at
// runtime (see e.g. `packages/audit/src/__tests__/foreign-vocabulary.ts`),
// and this file does the same. A split spelling — the halves as adjacent
// quoted literals, or a regex source — is still a discoverable mention, so
// this gate bans those idioms too; an allowlist would have to be burned down
// forever, while an opaque encoding needs nothing.
//
// Scope is the BRAND only, shaped so ordinary English survives: the plural
// phrase "<A> <B>ments" and "in the future, pay attention" are not offences.
// The domain-noun sweeps (mesa, comanda, R$ …) stay per-package, where the
// package's own vocabulary decides what is foreign.
//
// ## The one category this gate does NOT sweep, and why it is not an allowlist
//
// A published `migration.sql` is excluded — see `isFrozenMigration`. Prisma
// checksums the whole file, so an applied migration is not prose this repo can
// revise: editing one breaks `prisma migrate deploy` against every database
// that already ran it. This gate learned that the expensive way. Its first
// sweep rewrote comments inside EIGHT already-published migrations (12-50),
// which no lane could catch, because a suite that applies migration SQL to a
// fresh database never consults a checksum.
//
// That is a category, not a judgement call, which is what keeps NO ALLOWLIST
// intact: nobody decides whether a given migration deserves a pass, and no
// entry has to be burned down. The rule still binds — it simply binds when the
// migration is WRITTEN rather than for ever afterwards, and
// `migration-freeze-gate.mjs` is where that happens. A new migration is not yet
// frozen, so the freeze gate runs these very patterns over it before admitting
// it to the lock, and refuses one that names the host. After that the bytes are
// immutable and there is nothing left to enforce.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { Buffer } from "node:buffer";

// The name, base64-decoded at runtime so this gate is not its own first hit —
// under its own split-spelling ban, not just the plain ones.
const decode = (encoded) => Buffer.from(encoded, "base64").toString();
const A = decode("ZnV0dXJl");
const B = decode("cGF5");

/** Every spelling the repo has actually shipped, each with its own reason. */
export const BANS = [
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
  {
    // A SPLIT spelling: the halves as adjacent quoted literals — an array pair
    // or a concatenation — which is the idiom this repo once used to keep gate
    // files grep-clean, and which is itself a discoverable mention. The only
    // acceptable representation is an opaque one (base64, decoded at runtime).
    label: `${A}','${B} (split literals)`,
    pattern: new RegExp(`${A}['"\`]\\s*[,+]\\s*['"\`]${B}(?=['"\`.])`, "i"),
  },
  {
    // A regex-source spelling: the halves separated by a character class, as
    // in a hand-written ban pattern. Build such patterns from decoded parts.
    label: `${A}[…]${B} (regex source)`,
    pattern: new RegExp(`${A}\\[[^\\]]{0,12}\\]\\??${B}`, "i"),
  },
];

/**
 * The gate proves it can fire before claiming the tree is clean — a sweep
 * whose patterns rotted matches nothing and reads exactly like success.
 */
export function selftest() {
  const mustCatch = [
    `${A}-${B}`,
    `${A}_${B}_AUDIT_VOCABULARY`.toUpperCase(),
    `__${A}${B[0].toUpperCase()}${B.slice(1)}Store`,
    `${A}${B}.checkout.hostedOrder`,
    `o ${A[0].toUpperCase()}${A.slice(1)} ${B[0].toUpperCase()}${B.slice(1)} confirma`,
    `['${A}', '${B}'].join('')`,
    `"${A}" + "${B}"`,
    `${A}[\\s_-]?${B}|paladira`,
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

/**
 * A published migration's bytes are frozen by `migration-freeze-gate.mjs`, so
 * this sweep must not ask for an edit it cannot have. See the header.
 */
export const isFrozenMigration = (file) =>
  /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/.test(file);

/** Every offence in one file's text, as `path:line — label`. */
export function offencesIn(file, text) {
  return text.split("\n").flatMap((line, index) => {
    const hit = BANS.find(({ pattern }) => pattern.test(line));
    return hit ? [`${file}:${index + 1} — ${hit.label}`] : [];
  });
}

function sweep() {
  const offences = [];
  for (const file of trackedFiles()) {
    if (isFrozenMigration(file)) continue; // immutable — enforced at authoring, see the header
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted in the working tree, or unreadable — nothing to say
    }
    if (text.includes("\0")) continue; // binary
    offences.push(...offencesIn(file, text));
  }
  return offences;
}

/** Run only as a script: `migration-freeze-gate.mjs` imports the patterns. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
