/**
 * The DATABASE capability: the Prisma partial + migrations a package owns.
 *
 * The seam itself already exists and works — `packages/<pkg>/prisma/…`
 * copied (never symlinked) into the host's schema folder by per-package sync
 * scripts, with `--check` drift gates. What is missing is the DECLARATION:
 * nothing machine-readable says "this package owns models", so the host's
 * plugin-migration sync discovers contributions structurally by scanning
 * `node_modules`, and a package that gains its first model gains it silently.
 *
 * Declaring it here makes the contribution part of the manifest the wiring
 * report shows, so "adopted a package that owns tables and never synced its
 * partial" becomes a named unbound capability instead of a missing table in
 * production.
 */

/** Where a package keeps its schema contribution, relative to its own root. */
export interface PrismaContribution {
  /** The model partial — `prisma/<pkg>.prisma`. */
  readonly partial: string;
  /** The package-owned migrations folder — `prisma/migrations`. */
  readonly migrations?: string;
}
