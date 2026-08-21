// @vitest-environment node
/**
 * THE PUBLISHED ARTIFACT — swept, not the rendered output.
 *
 * A ban list run over a rendered screen proves one thing about one screen.
 * The tarball is bigger than the screen: `files` here publishes `src`,
 * `dist`, `features`, `prisma`, `scripts` and every top-level `*.md`, so a
 * host's language can ship in a docstring, a schema annotation, a compiled
 * `.d.ts` or a Gherkin line and never appear in a render. That is precisely
 * how it survived here — this package's 1.x shipped one application's copy as
 * the screen's defaults and that application's denial sentences compiled into
 * the routes, and no test looked.
 *
 * So this suite asks `npm pack` what would actually be uploaded, reads every
 * entry in that list off disk, and refuses a word belonging to the
 * application this package was extracted for — or to the copy it used to
 * default to. ONE deliberate exemption: the named pt-BR packs (`pt-BR.ts`)
 * exist precisely to carry that language as an explicit, reviewable import —
 * so they are excused from the removed-copy list alone, by exact filename,
 * and still swept for the origin brand, tickets and domain nouns. The same
 * judgement the repo copy gate makes, restated here for the tarball.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  foreignPatterns,
  removedCopyPatterns,
  type ForeignPattern,
} from "./foreign-vocabulary";

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
 * The pack, computed at most once per FILE — the audit package's hard-won
 * memoisation: npm takes tens of seconds a call on a loaded CI runner, and
 * repeated calls have pushed a sibling suite past vitest's worker RPC timeout
 * while every individual case stayed green. A module-private write-once
 * container rather than a `beforeAll` reassignment, so the flakiness lane
 * reads no shared mutable state and no case can observe another having run.
 */
const packCache: { entries?: readonly string[] } = {};
function packedFiles(): readonly string[] {
  packCache.entries ??= readPackedFiles();
  return packCache.entries;
}

/**
 * Files whose CONTENT is worth reading — everything textual. The sweep
 * asserts, in its own case, that EVERY packed entry matches this: a future
 * `.mts`, `.mdx` or `.yaml` would otherwise slip past and be swept by nothing
 * at all, silently and greenly. `.map` is here because `dist` ships compiled
 * `.js.map`/`.d.ts.map`, and `.feature` because the packaged journeys are
 * prose an operator's language could leak into.
 */
function isTextual(entry: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql|map|feature)$/.test(entry);
}

/** What one ban actually found in a file, as concrete text — deduplicated. */
function hitsFor(text: string, ban: ForeignPattern): string[] {
  const global = new RegExp(ban.pattern.source, `${ban.pattern.flags.replace("g", "")}g`);
  return [...new Set(text.match(global) ?? [])];
}

/**
 * The named packs — the ONLY packed entries allowed to carry the old
 * sentences, because carrying them by name is their whole job. Exact paths,
 * not a pattern: a new `pt-BR-ish.ts` gets no free pass.
 */
const NAMED_PACKS = new Set(["src/react/pt-BR.ts", "src/server/pt-BR.ts"]);

/** Every ban a packed entry's text trips, pack exemption included. */
export function offencesIn(entry: string, text: string): string[] {
  const bans = NAMED_PACKS.has(entry)
    ? foreignPatterns()
    : [...foreignPatterns(), ...removedCopyPatterns()];
  return bans.flatMap((ban) => hitsFor(text, ban).map((hit) => `${entry}: "${hit}"`));
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
    // The anti-vacuity guard for THIS case: an empty list here would mean the
    // pack call failed silently, and every `toContain` below would too.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/server/routes.ts");
    expect(files).toContain("src/react/create-feature-flags.tsx");
    expect(files).toContain("src/react/copy.ts");
    expect(files).toContain("src/server/copy.ts");
    // The named packs ARE published — the deliberate, reviewable way pt-BR
    // ships. The sweep below excuses exactly these two from the removed-copy
    // list and nothing else.
    expect(files).toContain("src/react/pt-BR.ts");
    expect(files).toContain("src/server/pt-BR.ts");
    expect(files).toContain("prisma/feature-flags.prisma");
    expect(files).toContain(
      "prisma/migrations/20260820120000_add_user_feature_grants/migration.sql",
    );
    expect(files).toContain("features/enrolling-a-beta-tester.feature");
    expect(files).toContain("scripts/sync-feature-flags-schema.mjs");

    // `files` excludes these, and it has to keep doing so: the portability
    // host names a second product's vocabulary on purpose, and the ban list
    // itself is a file full of banned words.
    const shipped = files.filter(
      (entry) => entry.includes("__tests__") || /\.(test|spec)\./.test(entry),
    );
    expect(shipped).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it("ships no default copy — the constant that carried it stays deleted", () => {
    // Named here rather than left to the word sweep: the sweep would also
    // pass if the defaults came back holding a DIFFERENT product's language.
    const copyModule = readFileSync(join(PACKAGE_ROOT, "src/react/copy.ts"), "utf8");
    expect(copyModule).not.toMatch(/DEFAULT_FEATURE_FLAGS_COPY/);
  });

  it("excuses the named packs from the removed-copy list alone, by filename", () => {
    // The exemption is exactly as wide as the two pack files: the same pt-BR
    // sentence is an offence one directory over, and the packs still answer
    // for the brand list (a ticket ref in a pack is as much a leak as
    // anywhere else).
    const sentence = 'title: "Recursos beta"';
    expect(offencesIn("src/react/pt-BR.ts", sentence)).toEqual([]);
    expect(offencesIn("src/react/copy.ts", sentence)).toEqual([
      'src/react/copy.ts: "Recursos"',
    ]);
    expect(offencesIn("src/server/pt-BR.ts", "granted (FUT-901)")).toEqual([
      'src/server/pt-BR.ts: "FUT-901"',
    ]);
  });

  it("carries no word belonging to the application it was extracted for", () => {
    const packed = packedFiles();
    const swept = packed
      .filter(isTextual)
      .filter((entry) => statSync(join(PACKAGE_ROOT, entry)).isFile());
    const offences = swept.flatMap((entry) =>
      offencesIn(entry, readFileSync(join(PACKAGE_ROOT, entry), "utf8")),
    );
    expect(offences).toEqual([]);
  }, PACK_TIMEOUT_MS);

  it("sweeps a non-empty list, and every packed entry is one it can read", () => {
    // The anti-vacuity guard, in its OWN case rather than folded into the
    // sweep: `offences` above is empty both when nothing leaks and when the
    // loop never ran, and a guard sharing a case with the assertion it
    // protects is one bad edit away from protecting nothing.
    const packed = packedFiles();
    const swept = packed.filter(isTextual);
    expect(swept.length).toBeGreaterThan(10);
    // A genuinely binary asset arriving here has to be an explicit decision
    // in this diff rather than a gap nobody sees.
    expect(packed.filter((entry) => !isTextual(entry))).toEqual([]);
  }, PACK_TIMEOUT_MS);
  /* eslint-enable test-flakiness/no-unmocked-fs */

  it("would catch a plant, so a green run means something", () => {
    // The same check, over text that IS a violation — without this the sweep
    // passes just as happily once the word list stops matching anything.
    const planted =
      'a loja concedendo o recurso ao usuário — "Página 1 de 2" custa R$59,00 (FUT-884)';
    const caught = offencesIn("src/planted.ts", planted);

    // Named, not counted: a plant that trips three other entries proves
    // nothing about the one being covered, and `length > 0` is satisfied by
    // any of them.
    expect(caught).toContain('src/planted.ts: "loja"');
    expect(caught).toContain('src/planted.ts: "concedendo"');
    expect(caught).toContain('src/planted.ts: "recurso"');
    expect(caught).toContain('src/planted.ts: "usuário"');
    expect(caught).toContain('src/planted.ts: "Página"');
    expect(caught).toContain('src/planted.ts: "R$"');
    expect(caught).toContain('src/planted.ts: "FUT-884"');
  });

  it("does not fire on the words this package needs to describe itself", () => {
    // A ban list needing exceptions is where a real value hides, so the
    // near-misses are pinned. Every one of these appears in published source.
    const innocent =
      "the flag catalog names each beta; a grant enrolls a person into the " +
      "cohort; an orphan is a grant whose key left the catalog; pagination " +
      "pages the grants, and the paginator's copy is the host's — see the " +
      "wiring manifest for the observability namespace and the veil doctrine.";
    expect(offencesIn("src/innocent.ts", innocent)).toEqual([]);
  });
});
