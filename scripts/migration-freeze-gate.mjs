// The migration freeze gate: a published `migration.sql` is immutable.
//
// Prisma stores a checksum of the WHOLE `migration.sql` in `_prisma_migrations`
// and compares it on every `prisma migrate deploy`. So a migration this repo has
// shipped is not a file any more — it is a fact recorded in every adopter's
// database. Change one byte of it, comment included, and every one of those
// databases fails to deploy.
//
// This is not hypothetical. `f837d49` (FUT-863) reworded comments inside EIGHT
// already-published migrations across `mcp`, `notifications`, `onboarding`,
// `prisma` and `shift` — pure prose, not one SQL statement touched — and
// silently broke `migrate deploy` for anyone who had applied them (12-50). The
// first adopter to notice was pinned two majors back and could not move.
//
// ## Why no existing lane could have caught it
//
// An integration suite applies migration SQL to a FRESH database. There is no
// prior checksum to disagree with, so it passes — cleanly, every time. The
// failure exists only against a database that already has the row, which means
// it is invisible until deploy, in production, at every adopter at once. A gate
// over the bytes themselves is the only place this is observable in CI.
//
// ## The lock
//
// `migration-freeze.json` maps each tracked `packages/*/prisma/migrations/*/
// migration.sql` to the sha256 of its contents. Verification is total:
//
//   - a locked file whose hash MOVED       -> fail (the bug above)
//   - a locked file that is GONE           -> fail (deleting it is the same break)
//   - a tracked migration NOT in the lock  -> fail (a lock with holes protects
//                                             nothing, and reads like success)
//
// The third rule is what makes this a ratchet rather than a snapshot: coverage
// cannot quietly stop growing with the tree.
//
// ## Where the brand rule went
//
// `host-brand-gate.mjs` skips these files, because it cannot ask for an edit
// that breaks production. The rule still binds — it binds HERE, at the only
// moment the bytes are still soft. Admitting a migration to the lock runs that
// gate's own patterns over it (imported, not re-spelled, so the two cannot
// drift) and refuses one that names the origin host. Once admitted the content
// is frozen, and there is nothing left to enforce for ever afterwards.
//
// ## Seeding is not admitting
//
// The very first lock is a different act from every one after it, and conflating
// the two is a trap this gate walked into once already. `--update` runs the brand
// patterns because a migration entering the lock is still soft. But on the FIRST
// run nothing is soft: every migration in the tree has already shipped, several
// of them naming the origin host in comments written before FUT-863. Refusing to
// freeze those would demand the exact edit that caused 12-50.
//
// So `--seed` records the tree as it stands, brand and all, and refuses to run
// once a lock exists — history gets recorded, not relitigated. Afterwards only
// `--update` can add anything, and it holds the line.
//
// Usage:
//   node scripts/migration-freeze-gate.mjs            # verify (CI, quality:portability)
//   node scripts/migration-freeze-gate.mjs --update   # admit new migrations
//   node scripts/migration-freeze-gate.mjs --seed     # one-time: record what shipped
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { BANS, offencesIn } from "./host-brand-gate.mjs";

const LOCK = "migration-freeze.json";
const MIGRATION = /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Tracked migrations only: `git ls-files` already excludes node_modules and dist. */
function trackedMigrations() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((file) => file && MIGRATION.test(file))
    .sort();
}

const readLock = () => (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {});

/**
 * The gate proves it can fire before claiming the tree is clean — a freeze
 * whose hashing rotted matches nothing and reads exactly like success. It also
 * proves the imported brand patterns still bite, since admitting a migration is
 * the only place they are enforced.
 */
function selftest() {
  if (sha256("a") === sha256("b")) {
    console.error("migration-freeze selftest: sha256 is not discriminating");
    process.exit(1);
  }
  const brandSample = Buffer.from("ZnV0dXJlLXBheQ==", "base64").toString();
  if (offencesIn("sample.sql", `-- ${brandSample} created them`).length === 0) {
    console.error("migration-freeze selftest: the imported brand patterns no longer fire");
    process.exit(1);
  }
  if (BANS.length === 0) {
    console.error("migration-freeze selftest: no brand patterns imported");
    process.exit(1);
  }
  for (const positive of ["packages/shift/prisma/migrations/20260731210000_x/migration.sql"]) {
    if (!MIGRATION.test(positive)) {
      console.error(`migration-freeze selftest: failed to match ${positive}`);
      process.exit(1);
    }
  }
  for (const negative of ["packages/shift/prisma/schema.prisma", "docs/migration.sql.md"]) {
    if (MIGRATION.test(negative)) {
      console.error(`migration-freeze selftest: false match on ${negative}`);
      process.exit(1);
    }
  }
}

function verify() {
  const lock = readLock();
  const tracked = trackedMigrations();
  const problems = [];

  for (const file of tracked) {
    const actual = sha256(readFileSync(file, "utf8"));
    const frozen = lock[file];
    if (!frozen) {
      problems.push(
        `${file}\n      NOT FROZEN. Run "pnpm quality:migrations:update" and commit the lock.`,
      );
    } else if (frozen !== actual) {
      problems.push(
        `${file}\n      EDITED. Frozen ${frozen.slice(0, 12)}…, now ${actual.slice(0, 12)}….\n` +
          `      This migration has shipped; Prisma checksums it. Revert the file — a\n` +
          `      correction ships as a NEW migration, never as an edit to this one.`,
      );
    }
  }

  for (const file of Object.keys(lock)) {
    if (!tracked.includes(file)) {
      problems.push(
        `${file}\n      DELETED but frozen. Removing a shipped migration breaks deploy the\n` +
          `      same way editing it does.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`migration-freeze: ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    process.exit(1);
  }
  console.log(`migration-freeze: clean — ${tracked.length} published migration(s) unchanged.`);
}

/**
 * One-time: record every migration already in the tree, exactly as it stands.
 *
 * No brand check — see the header. These bytes shipped before this gate existed
 * and several predate FUT-863, so demanding they be clean would demand the edit
 * that broke deploy in the first place. Guarded on the lock's absence so it can
 * never be used to launder a later edit past `--update`.
 */
function seed() {
  if (existsSync(LOCK)) {
    console.error(
      `migration-freeze: ${LOCK} already exists — --seed is one-time.\n` +
        "Use --update to admit new migrations; it applies the brand rule, which is\n" +
        "the whole point of the distinction.",
    );
    process.exit(1);
  }
  const tracked = trackedMigrations();
  const next = {};
  for (const file of tracked) next[file] = sha256(readFileSync(file, "utf8"));
  writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`migration-freeze: seeded — ${tracked.length} published migration(s) frozen.`);
}

function update() {
  const lock = readLock();
  const tracked = trackedMigrations();
  const next = {};
  const added = [];
  const refused = [];

  for (const file of tracked) {
    const text = readFileSync(file, "utf8");
    if (lock[file]) {
      // Already frozen: carry the RECORDED hash, never the current bytes, or
      // --update would launder exactly the edit this gate exists to refuse.
      next[file] = lock[file];
      continue;
    }
    const offences = offencesIn(file, text);
    if (offences.length > 0) {
      refused.push(`${file}\n      ${offences.join("\n      ")}`);
      continue;
    }
    next[file] = sha256(text);
    added.push(file);
  }

  if (refused.length > 0) {
    console.error(
      `migration-freeze: refusing to freeze ${refused.length} migration(s) naming the origin host:\n`,
    );
    for (const problem of refused) console.error(`  ${problem}\n`);
    console.error(
      "This is the last moment these bytes can change. Once frozen the comment is\n" +
        "permanent, because Prisma checksums the file and every adopter that applied\n" +
        "it would break. Reword it generically ('the origin host') and re-run.",
    );
    process.exit(1);
  }

  const dropped = Object.keys(lock).filter((file) => !tracked.includes(file));
  writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`migration-freeze: ${added.length} added, ${Object.keys(next).length} frozen.`);
  for (const file of added) console.log(`  + ${file}`);
  if (dropped.length > 0) {
    console.log(
      `\nNOTE: ${dropped.length} frozen migration(s) are no longer tracked and were dropped from\n` +
        "the lock. That is only correct if they were never published — verify before committing:",
    );
    for (const file of dropped) console.log(`  - ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selftest();
  if (process.argv.includes("--seed")) seed();
  else if (process.argv.includes("--update")) update();
  else verify();
}
