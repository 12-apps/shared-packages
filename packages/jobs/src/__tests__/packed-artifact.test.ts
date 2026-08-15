// @vitest-environment node
/**
 * THE PUBLISHED ARTIFACT — swept, not the rendered output.
 *
 * This package renders nothing, so a ban list run over some surface's output
 * would prove nothing at all. What ships is `src` (minus tests), `prisma` and
 * every `*.md` — so a host's vocabulary can leave through a comment, a doc
 * sentence, a schema annotation or a migration and be invisible to every
 * behavioural test in the suite. That is precisely how it survived here: the
 * origin application was named nineteen times across five published files.
 *
 * So this suite asks `npm pack` what would actually be uploaded, reads every
 * entry in that list off disk, and refuses a word belonging to the application
 * this package was extracted from.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * What `npm publish` would upload, straight from npm rather than from a
 * reimplementation of the `files` field — a second copy of those globs would
 * rot in the direction of not looking.
 */
function readPackedFiles(): readonly string[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [tarball] = JSON.parse(raw) as [{ files: { path: string }[] }];
  return tarball.files.map((file) => file.path);
}

/**
 * The pack, computed at most once per file.
 *
 * Calling {@link readPackedFiles} per case is what stopped this repo publishing
 * (#173, in `@12-apps/entitlements`): npm takes ~26s a call on a runner
 * building 31 packages at once, so two calls put the FILE past vitest's worker
 * RPC timeout while every individual case stayed inside its own budget and
 * passed. The resulting unhandled error fails the run whatever the assertions
 * said, `Release` needs that job so it is SKIPPED rather than failed, and the
 * cause is invisible from the log tail. This file was cut from the template
 * before that fix landed and carried the same two call sites.
 *
 * Memoised HERE rather than in a `beforeAll`, because a describe-scoped binding
 * reassigned from a hook is shared mutable state and reads as an order
 * dependency (`test-flakiness/no-test-isolation`), while a module-level `let`
 * reassignment trips `no-global-state-mutation`. The cache is a module-private
 * container property, write-once, and the pack is a pure read of the working
 * tree — so one call is as true as three and no case can observe another
 * having run first.
 */
const packCache: { entries?: readonly string[] } = {};
function packedFiles(): readonly string[] {
  packCache.entries ??= readPackedFiles();
  return packCache.entries;
}

/**
 * A ban is either an exact literal or a pattern.
 *
 * A pattern reports the CONCRETE TEXT it matched, never its own source, which
 * is what keeps an exemption as narrow as it claims to be: exempting
 * `FUT-343` on one path leaves `FUT-901` on that same path failing.
 */
type Ban = string | RegExp;

/**
 * Every word belonging to the host application this package came out of: its
 * name, its domain nouns, its job identifiers, its ticket namespace, its
 * currency and its timezone.
 *
 * Matched case-insensitively against the whole packed file, so a comment, a
 * doc sentence and a schema annotation are all in scope. Built fresh per call
 * so no test can mutate what a later one checks against.
 *
 * The job names are the sharp ones for a JOBS package. `billing.tick` and
 * `notifications.dispatch` read like neutral examples and are not: they are
 * the identifiers of another product's schedules, and they were the examples
 * in the README, the root module header, the payload rule and the schema
 * partial's own doc comment.
 */
const FP1 = atob("ZnV0dXJl");
const FP2 = atob("cGF5");
function foreignWords(): readonly Ban[] {
  return [
    // base64-DECODED so this ban list is not its own hit in the repo-wide
    // brand sweep, which bans even a split spelling.
    `${FP1} ${FP2}`,
    `${FP1}-${FP2}`,
    `${FP1}${FP2}`,
    // The origin project's TICKET NAMESPACE. A key from one organisation's
    // tracker is host data like any other noun, and it is the shape that
    // reaches a published file most easily — nobody reads a `(FUT-901)` in a
    // comment as a leak. Deliberately the exact prefix rather than a generic
    // `[A-Z]{2,}-\d+`, which would fire on `UTF-8`, `RFC-3339` and `ISO-8601`;
    // a ban that cries wolf gets deleted, and then it protects nothing.
    /\bFUT-\d+\b/gi,
    // Domain nouns, including the pt-BR the storefront ships in.
    "loja",
    "mesas",
    "comanda",
    "cozinha",
    "cardápio",
    "estoque",
    "garçom",
    "salão",
    "pagbank",
    "storefront",
    "restaurant",
    // No trailing space: `R$59,00` is how a price is actually written, and a
    // pattern of `'R$ '` would let that straight through.
    "R$",
    // Another product's job identifiers and their vocabulary.
    "billing.tick",
    "billing.charge",
    "notifications.dispatch",
    "notifications.drain",
    "stock.low-alert",
    "stock.low-crossing",
    "payments.webhook-drain",
    "payments.oauth-renewal",
    "waiter-call.escalate",
    "shift.auto-close",
    "dunning",
    // That product's own clock. A package that hardcodes a zone in an example
    // is telling every other adopter when their night job runs.
    "America/Sao_Paulo",
    "São Paulo",
  ];
}

/**
 * TWO exemptions, recorded here rather than left as unexplained gaps in the
 * ban list. Both are files whose BYTES are pinned to something outside this
 * package, so the fix is not "edit the string" — it is a second, coordinated
 * change that does not belong in this release.
 *
 * 1. `prisma/migrations/.../migration.sql` carries the origin project's ticket
 *    reference in its header comment, which the ticket-namespace ban catches.
 *    Prisma checksums an applied migration: editing so much as a comment makes
 *    `migrate deploy` refuse the next deploy of every host that already ran
 *    it. That is a production outage traded for a seven-character comment, and
 *    the directory is deliberately a byte-identical copy of one already
 *    applied in production.
 *
 * 2. `prisma/jobs.prisma` still uses a host's job name as the example value of
 *    the `name` column, and names a pre-2.0.0 path for the sync script. This
 *    file is byte-compared against a COMMITTED COPY in the schema-host package
 *    (`sync-jobs-schema.mjs --check`, wired into that package's `build` and
 *    `prisma:generate`), so changing one byte here turns the whole workspace's
 *    `check-types` red until the copy is re-synced — a change in another
 *    package's directory, which semantic-release would read as a release of
 *    THAT package. It is a two-line comment fix that has to ride the commit
 *    which can also carry the sync; ADOPTING.md says so, with the command.
 *
 * Each is scoped to the exact MATCHED TEXT on an exact path — never to a
 * pattern, and never to the file. A different ticket in the same file still
 * fails, a different foreign word in the same file still fails, and the same
 * word in any other file still fails; the last case below proves all three
 * against the real ban list.
 */
const EXEMPT = new Map<string, readonly string[]>([
  ["prisma/migrations/20260727190000_sweep_leases/migration.sql", ["FUT-343"]],
  ["prisma/jobs.prisma", ["billing.tick"]],
]);

/** Files whose CONTENT is worth reading — everything textual. */
function isTextual(entry: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql)$/.test(entry);
}

/** What one ban actually found in a file, as concrete text. */
function hitsFor(text: string, ban: Ban): string[] {
  if (typeof ban === "string") {
    return text.toLowerCase().includes(ban.toLowerCase()) ? [ban] : [];
  }
  // The matched text, not the pattern source — see {@link Ban}. Deduplicated so
  // one banned key repeated in a file is one offence, not a wall of them.
  return [...new Set(text.match(ban) ?? [])];
}

/** Every ban a file's text trips, minus that file's recorded exemptions. */
function offencesIn(entry: string, text: string, banned: readonly Ban[]): string[] {
  const exempt = EXEMPT.get(entry) ?? [];
  const offences: string[] = [];
  for (const ban of banned) {
    for (const hit of hitsFor(text, ban)) {
      if (exempt.some((allowed) => allowed.toLowerCase() === hit.toLowerCase())) continue;
      offences.push(`${entry}: "${hit}"`);
    }
  }
  return offences;
}

describe("the tarball npm would upload", () => {
  // `npm pack --dry-run` shells out and reads the whole tree; under the full
  // suite's parallelism it comfortably outruns the 5s default.
  const PACK_TIMEOUT_MS = 60_000;

  /* eslint-disable test-flakiness/no-unmocked-fs --
     the real file system IS the subject. What this asserts is a property of
     the bytes npm would upload, so reading them through a mock would assert a
     property of the mock instead. */
  it("publishes the entries the manifest claims, and no tests", () => {
    const files = packedFiles();
    // The anti-vacuity guard: a sweep over an empty list proves nothing, and
    // an empty list here would mean the pack call failed silently.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("ADOPTING.md");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/server/create-api-jobs.ts");
    expect(files).toContain("prisma/jobs.prisma");
    expect(files).toContain(
      "prisma/migrations/20260727190000_sweep_leases/migration.sql",
    );

    // `files` excludes these, and it has to keep doing so: the portability
    // host and the fixtures name a vocabulary on purpose, and this very ban
    // list is a file full of banned words.
    const shipped = files.filter(
      (entry) => entry.includes("__tests__") || /\.(test|spec)\./.test(entry),
    );
    expect(shipped).toEqual([]);

    // `docs/` used to hold a host-upgrade note that named ONE application on
    // every page; the note moved to that application's own repo. `files` keeps
    // the explicit `!docs/**` exclusion so a future doc naming a host cannot
    // ship by accident — and this is the assertion that keeps it excluded.
    expect(files.filter((entry) => entry.startsWith("docs/"))).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it("carries no word belonging to the application it was extracted from", () => {
    const banned = foreignWords();
    const packed = packedFiles();
    // Built by transformation rather than by pushing into an accumulator: the
    // flakiness lane reads a mutated array in a test body as shared state, and
    // it is right often enough to be worth writing around.
    const swept = packed
      .filter(isTextual)
      .filter((entry) => statSync(join(PACKAGE_ROOT, entry)).isFile());
    const offences = swept.flatMap((entry) =>
      offencesIn(entry, readFileSync(join(PACKAGE_ROOT, entry), "utf8"), banned),
    );
    expect(offences).toEqual([]);

    // Anti-vacuity, inside THIS case rather than the one next door: `offences`
    // is empty both when nothing leaks and when the loop never ran. The
    // file-count guard lives in another `it`, so it protects that case only.
    expect(swept.length).toBeGreaterThan(10);

    // And the loop must have covered EVERY published entry. `files` also ships
    // `dist`, so a future `.mts`, `.cts`, `.map`, `.mdx` or `.yaml` would slip
    // past `isTextual` and be swept by nothing at all — silently, greenly. A
    // genuinely binary asset arriving here has to be an explicit decision in
    // this diff rather than a gap nobody sees.
    expect(packed.filter((entry) => !isTextual(entry))).toEqual([]);
  }, PACK_TIMEOUT_MS);
  /* eslint-enable test-flakiness/no-unmocked-fs */

  it("would catch a plant, so a green run means something", () => {
    // The same check, run over text that IS a violation — without this the
    // sweep above passes just as happily once the word list stops matching
    // anything at all.
    const planted =
      'o billing.tick da loja roda 07:00 em America/Sao_Paulo e cobra R$59,00 no PagBank';
    const caught = offencesIn("src/planted.ts", planted, foreignWords());

    // Named, not counted: a plant that trips three other entries proves
    // nothing about the one being covered, and `length > 0` is satisfied by
    // any of them. Each of these is an entry that a real leak used.
    expect(caught).toContain('src/planted.ts: "billing.tick"');
    expect(caught).toContain('src/planted.ts: "loja"');
    expect(caught).toContain('src/planted.ts: "America/Sao_Paulo"');
    expect(caught).toContain('src/planted.ts: "R$"');
    expect(caught).toContain('src/planted.ts: "pagbank"');
  });

  it("bans the ticket namespace, so the migration's exemption is load-bearing", () => {
    // Without this ban the migration exemption is inert: `migration.sql` would
    // trip nothing, deleting the entry would change no result, and the case
    // below would be proving the scoping of a rule the sweep does not have.
    // It also closes the leak that reaches a published file most easily — a
    // `(FUT-901)` in a README or a source comment reads as housekeeping.
    expect(offencesIn("README.md", "closes FUT-901", foreignWords())).toEqual([
      'README.md: "FUT-901"',
    ]);
    expect(offencesIn("src/index.ts", "// see FUT-12 for why", foreignWords())).toEqual([
      'src/index.ts: "FUT-12"',
    ]);

    // Exactly this prefix, deliberately: a generic `[A-Z]{2,}-\d+` would fire
    // on these, and a ban that cries wolf gets deleted.
    expect(
      offencesIn("src/index.ts", "UTF-8, RFC-3339 and ISO-8601", foreignWords()),
    ).toEqual([]);
  });

  it("keeps both exemptions narrow — exact literals, exact paths", () => {
    // An exemption that swallowed the whole file would hide the next leak in
    // it, and one keyed on the pattern rather than the matched text would hide
    // every ticket ref in that file forever. Every assertion here runs the
    // REAL ban list: a hand-written literal would prove the scoping of a rule
    // that is not the one the sweep applies.
    const migration = "prisma/migrations/20260727190000_sweep_leases/migration.sql";
    const partial = "prisma/jobs.prisma";
    const banned = foreignWords();

    expect(offencesIn(migration, "-- (FUT-343)", banned)).toEqual([]);
    expect(offencesIn(partial, '/// e.g. "billing.tick"', banned)).toEqual([]);

    // Same file, a DIFFERENT ticket: the exemption is one literal, not the
    // pattern, so the next ref added to that file still fails.
    expect(offencesIn(migration, "-- (FUT-901)", banned)).toEqual([
      `${migration}: "FUT-901"`,
    ]);
    // Same file, a different foreign word: still a failure.
    expect(offencesIn(migration, "-- billing.tick", banned)).toEqual([
      `${migration}: "billing.tick"`,
    ]);
    expect(offencesIn(partial, "/// one lease per loja", banned)).toEqual([
      `${partial}: "loja"`,
    ]);

    // Same word, any other file: still a failure. The exemption is a property
    // of the two byte-pinned files, not a hole in the word list.
    expect(offencesIn("src/index.ts", "// FUT-343", banned)).toEqual([
      'src/index.ts: "FUT-343"',
    ]);
    expect(offencesIn("src/index.ts", "// billing.tick", banned)).toEqual([
      'src/index.ts: "billing.tick"',
    ]);
  });
});
