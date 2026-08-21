/**
 * `@12-apps/payments-backend/manifest` — the SHARED wiring manifest.
 *
 * UNTYPED pure data, unlike every sibling producer half: the portability
 * ruleset (`payments/no-host-imports`) allows no `@12-apps/wiring` import in
 * this package, type-only included — it must vendor into a repo that has no
 * wiring contract at all. The compliance run lives in the wiring suite's
 * `payments-manifest.test.ts` instead, along the dependency edge that does
 * exist (the `@12-apps/jobs` manifest's move), so a drift still fails a test
 * run before any host sees it.
 *
 * TWO manifests, because the package ships TWO route tables that must never
 * merge (`http/mount.ts` argues the privilege split: every library row is
 * merchant-admin, machine or merchant-scoped; every checkout row is the
 * BUYER). The auth-platform split is the precedent: a host binds each
 * surface behind its own gate, and a version bump can never widen one mount
 * with the other's rows. Both `http` capabilities are COUNTABLE VIEWS
 * (`http/wire-view`, `checkout/wire-view`) over the mounts, which stay
 * exactly what they were — the raw request in and the raw response out are
 * what the handlers always needed (webhook signatures over exact bytes,
 * provider-shaped bodies, OAuth redirects), and the contract now carries
 * both. `email` is the receipt mailer seam; its words arrive at
 * manifest-build time (`./server` is a FUNCTION for auth's reason).
 *
 * The remaining absences are deliberate, and the suite pins each one:
 *
 * - **No `mcp`, no `permissions`.** The package advertises no tools, and
 *   every authorization question is a host port (`requireAuth`).
 * - **No `e2e`.** The journeys ship in the SIBLING package
 *   `@12-apps/payments-e2e`; a manifest must not declare an entry another
 *   package exports.
 * - **No `env`.** Zero `process.env` reads in shipped source. `PAYMENTS_STUB`
 *   is read by the HOST and handed in via `resolveStubMode(process.env)`,
 *   and the OAuth credential names are COMPUTED per provider
 *   (`envOAuthAppCredentials`) — not enumerable as static `WireEnvVar`s.
 *
 * `observability` names where a wiring host files the bound handlers'
 * reports. The package itself still binds no logger anywhere — that trait is
 * load-bearing (six source comments say so) and unchanged.
 */

export const paymentsBackendManifest = {
  name: '@12-apps/payments-backend',
  contract: 1,
  db: { partial: 'prisma/payments.prisma', migrations: 'prisma/migrations' },
  observability: { namespace: 'payments' },
  server: ['http', 'jobs', 'email'],
} as const;

/**
 * The buyer-checkout surface's own identity. No `db` (the schema is the
 * library manifest's), no jobs, no email — one capability, one gate.
 */
export const paymentsCheckoutManifest = {
  name: '@12-apps/payments-checkout',
  contract: 1,
  observability: { namespace: 'payments-checkout' },
  server: ['http'],
} as const;
