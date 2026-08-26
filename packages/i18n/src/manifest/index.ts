import type { PackageManifest } from '@12-apps/wiring';

/**
 * `@12-apps/i18n`'s producer half of the wiring contract.
 *
 * ## Why a package of pure mechanism grew a manifest
 *
 * Everything else here is stateless: a canonical list, a pack, a precedence
 * order, a formatter. None of it needed declaring, because none of it needed
 * anything FROM a host.
 *
 * One fact does. "Which language does this person read" is the input every
 * resolver in the estate takes and the one thing none of them could obtain —
 * and it cannot live in a browser, because the readers that need it most have
 * no browser in the room. A notification is stored as rendered TEXT and read
 * later; a mail is sent by a background job. So this package owns a table, and
 * a table plus the two endpoints over it is exactly what the contract exists to
 * declare.
 *
 * ## Why the storage is a TABLE and not a column
 *
 * `prisma/i18n.prisma` says it at length, and it is the lesson `auth.prisma`
 * already records about its three credential columns: a package cannot add a
 * column to a table it does not own, and a host should not hand-edit its own
 * user model to install a language preference. `user_id` carries no foreign
 * key, so this applies to a repo whose user table is named something else, is
 * in another database, or does not exist yet at migrate time.
 *
 * ## Why `@12-apps/wiring` is a type-only import, and declared as an OPTIONAL PEER
 *
 * The doctrine `@12-apps/auth`'s manifest states in full, and it binds harder
 * here than anywhere: this package is depended on by most of the estate, so
 * making the contract a runtime dependency would push it into every installer's
 * tree AND put this package's releases behind the contract's. The manifests are
 * plain values `satisfies`-checked against the contract's types; the runtime
 * assertions and the inventory drift-check run in this package's own suite.
 * Nothing below survives compilation, and the zero runtime dependencies stand.
 *
 * It takes TWO declarations to be honest about that, not one. The
 * devDependency is what types this file while it is built here. The OPTIONAL
 * PEER is what a consumer sees: this package ships `src/`, so anything
 * resolving `./server` reads an import of `@12-apps/wiring` — and a package
 * importing something it never declares is broken for that consumer, whether or
 * not the import is erased. Optional, because a host that never adopts the
 * contract never needs it installed.
 */
export const i18nManifest = {
  name: '@12-apps/i18n',
  contract: 1,
  db: { partial: 'prisma/i18n.prisma', migrations: 'prisma/migrations' },
  /** A refusal to store a language files under `i18n`, not nowhere. */
  observability: { namespace: 'i18n' },
  server: ['http'],
} as const satisfies PackageManifest;
