import type { PackageManifest } from '@12-apps/wiring';

/**
 * `@12-apps/email`'s producer half of the wiring contract.
 *
 * ## What it declares, and what it deliberately does not
 *
 * Two capabilities, and both are surfaces a host MOUNTS rather than facts a
 * host stores:
 *
 * - **`http`** — the preview catalogue's two endpoints;
 * - **`surface`** — the operator screen over them.
 *
 * There is no `db`. That is the whole shape of this package: it owns a LAYOUT
 * and a CATALOGUE, and a catalogue is derived from whatever the host already
 * has rather than persisted. Nothing here has state to migrate, which is why a
 * host adopts it without touching its schema.
 *
 * There is no `email` capability either, and that one is worth stating because
 * the name invites it. The contract's `email` capability is a DELIVERY port —
 * a host's one driver, handed to a package that needs to send something. This
 * package sends nothing: it renders, and the sending stays with whichever
 * package or host code owns the message. A declaration here would advertise a
 * seam that does not exist, and an adopter binding a driver to it would be
 * wiring a port nothing reads.
 *
 * ## Why `@12-apps/wiring` is a type-only import, declared as an OPTIONAL PEER
 *
 * The doctrine `@12-apps/auth`'s manifest states in full. The manifests are
 * plain values `satisfies`-checked against the contract's types, so nothing
 * below survives compilation and the zero runtime dependencies stand. It takes
 * TWO declarations to be honest: the devDependency types this file while it is
 * built here, and the OPTIONAL PEER is what a consumer sees, because this
 * package ships `src/` and anything resolving `./manifest` reads an import of
 * the contract. Optional, because a host that never adopts the contract never
 * needs it installed.
 */
export const emailManifest = {
  name: '@12-apps/email',
  contract: 1,
  /** A refusal to render a preview files under `email`, not nowhere. */
  observability: { namespace: 'email' },
  server: ['http'],
  web: ['surface'],
} as const satisfies PackageManifest;
