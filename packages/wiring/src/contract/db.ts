/**
 * The DATABASE capability: how a package's models reach the host's database.
 *
 * Two modes, and the PACKAGE decides which one it is:
 *
 * **`composed`** (the default, and the only mode that existed before) — the
 * package ships a Prisma model PARTIAL that the host copies (never symlinks)
 * into its own schema folder, plus optionally the migrations that built those
 * models. One host client, one compilation unit: the package's models share
 * the host's transactions and client extensions, and may in principle relate
 * to host models. The copy is forced by Prisma itself — the schema language
 * has no import, one folder is the compilation unit, and symlinks fail three
 * separate ways (`npm pack` drops them, `turbo prune` dangles them, and a
 * symlinked migration directory is silently SKIPPED by migrate) — so the
 * contract's job is to make the copy declarative: the host's assembler reads
 * this contribution instead of growing a hand-written sync script per
 * package.
 *
 * **`isolated`** — the package owns its WHOLE Prisma stack: its own schema,
 * its own generated client, its own migrations, running against the same
 * database but inside its own Postgres schema (`?schema=<pgSchema>` on the
 * connection URL, which also gives it its own `_prisma_migrations`). Nothing
 * is copied anywhere; the host hands the package a connection string and
 * runs the package's `migrate deploy` at release time. The cost is the seam:
 * the package's models leave the host client, so no single transaction spans
 * host + package writes and no host client extension covers these models —
 * which is why isolation is a per-package decision, not a default. A package
 * qualifies only when its models carry no relation into host tables.
 *
 * Because host-side tooling is plain Node that cannot execute a package's
 * TypeScript manifest, the contribution is MIRRORED into the package's
 * `package.json` under `"wiring": { "db": ... }` — plain JSON the assembler
 * can read from `node_modules`. The producer's `assertDbMirror` pins the
 * mirror against the manifest in the package's own test run, so the two
 * cannot drift.
 */

/** The partial the host composes into its schema folder (the default mode). */
export interface ComposedPrismaContribution {
  /** Absent means `composed` — the shape every existing manifest already has. */
  readonly mode?: "composed";
  /** The model partial — `prisma/<pkg>.prisma`, relative to the package root. */
  readonly partial: string;
  /** The package-owned migrations folder — `prisma/migrations`. */
  readonly migrations?: string;
}

/** The package's own full Prisma stack, isolated in its own Postgres schema. */
export interface IsolatedPrismaContribution {
  readonly mode: "isolated";
  /** The package's OWN schema (file or folder), relative to the package root. */
  readonly schema: string;
  /** The migrations the package's own `migrate deploy` applies. Required — an isolated package with no migrations deploys nothing. */
  readonly migrations: string;
  /**
   * The Postgres schema its tables and `_prisma_migrations` live in. Never
   * `public` — that is the host's, and sharing it re-creates the migration
   * table collision isolation exists to avoid.
   */
  readonly pgSchema: string;
}

export type PrismaContribution =
  | ComposedPrismaContribution
  | IsolatedPrismaContribution;

/** Narrow a contribution to its mode without repeating the default rule. */
export function isIsolatedDb(
  db: PrismaContribution,
): db is IsolatedPrismaContribution {
  return db.mode === "isolated";
}
