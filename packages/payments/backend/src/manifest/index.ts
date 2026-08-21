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
 * The absences are deliberate, and that suite pins each one:
 *
 * - **No `http`.** The package ships TWO route tables that must never merge
 *   (`http/mount.ts` argues the privilege split: admin `requireAuth` vs
 *   buyer), as segment-array dispatch closures behind framework-free mounts
 *   with host-provided intents (`extensions`) — not `WireRoute` descriptors
 *   a consumer could count. `mountPayments`/`createPaymentFlowsBE` stay
 *   direct host calls, exactly what `.payments-surface.json`'s `wiring`
 *   class exists to keep small.
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
  server: ['jobs'],
} as const;
