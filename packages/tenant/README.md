# @12-apps/tenant

Domain-agnostic tenant behaviours. A tenant may be a shop, a hospital, a clinic
or anything else: the package knows only "tenant", and each host configures it
with its own vocabulary, ids, copy and a port onto its own tenant row.

This first release ships the **contract** every later behaviour extends:

- the config types: the host's full status set (with the statuses a close may
  start from), the id set (refusal codes, audit action ids, notification type
  ids, permission ids) and whole-sentence copy packs per locale. Every id and
  sentence the later behaviours need is required already, so a later release
  never adds a required piece to a host's config;
- the **tenant port** the package reaches the host's tenant row through:
  `bySlug`, `byId(id, tx?)`, `setStatusIf(id, from, to, tx)`,
  `clearProfile(tx, id)`, `timeZone(id)`. Its writes run on the caller's
  transaction;
- the **tenant tree**, OPT-IN: a tenant under a parent, any depth, on a
  materialized path the package computes and validates, through a `tree` port
  of its own (`treeNode`, `treeAncestors`, `treeDescendants`,
  `moveSubtree(move, tx)`); `parentOf`, `rootOf`, `ancestorsOf`, `descendantsOf`
  (one port call each) and a subtree `move` that refuses a cycle. A host that
  passes no `tree` gets no `tenant.tree`;
- `createApiTenant` and `createWebTenant`, which validate all of it at startup
  and keep a deep-frozen copy of the data;
- the package's own tables, `tenant_closings` and `tenant_data_exports`, as a
  Prisma partial with its own migration.

The closing lifecycle (close and reopen as a dangerous act, the blockers, the
sweep that reminds and purges, and the admin and public gates) is opt-in:
`createApiTenant({ lifecycle })` and `createTenantGates`. The purge and the
data export arrive in later releases on top of the same config. How to adopt it: [ADOPTING.md](./ADOPTING.md).

## Entry points

| Import | What | Needs |
|---|---|---|
| `@12-apps/tenant` | config types, the lifecycle's pure readings (`isTenantGone`, `sameTenantName`, `purgeAtFor`, `reminderDue`), `TenantPort`, `TenantConfigError`, the validators, the tree (`createTenantTree`, the path helpers, `TenantTreeError`), slug resolution (`createKeptMemory`, `createSlugResolver`, `createKeptSlugs`, `createTenantSlugs`, `TenantSlugPort`), custom domains' server half (`createTenantDomains`, `createDnsChecks`, `createTlsAsk`, `TenantDomainPort`, `TenantDomainQuota`) | nothing |
| `@12-apps/tenant/server` | `createApiTenant` (with `tenant.tree` when a `tree` port is given, `tenant.slugs` when `slugs` is, `tenant.lifecycle` when `lifecycle` is, `tenant.domains` when `domains` is), `createTenantLifecycle`, `createTenantGates`, `TenantLifecycleRefusal`, and the slug resolution and custom domain exports | nothing |
| `@12-apps/tenant/domains` | custom domains' pure half, browser-safe: `hostnameOrNull`, `createDomainDns` (the records under your TXT prefix), the zone helpers, `domainsOf` and the record types, `canonicalHostOf`, `pairRedirectOf`, the planner | nothing |
| `@12-apps/tenant/domains/react` | `createDomainsScreen` (the domains card, every word your pack, your confirm button and segmented control injected), the records parts | `react`, `@12-apps/ui`, `@mui/icons-material` |
| `@12-apps/tenant/lifecycle/react` | `createClosingScreens` (the owner's close page with its dialog, the closing banner, the gone screen, the refusal readers) and `createPlatformArchive` (the platform's archive panel and card): every word your pack, every code, path, widget and data hook yours | `react`, `@12-apps/ui`, `@mui/icons-material` |
| `@12-apps/tenant/hono` | `mountTenant(app, tenant)`, `mountTenantGates(app, gates)`, `tenantAdminGate`, `tenantPublicGate` | `hono` |
| `@12-apps/tenant/react` | `createWebTenant` | nothing yet |
| `@12-apps/tenant/manifest` | the wiring manifest (`db`) | `@12-apps/wiring` (types) |

## Rules the package keeps

- **Domain-agnostic.** `src/__tests__/domain-agnostic.test.ts` searches every
  source file, as whole words and ignoring case, for the vocabulary of the host
  the package was extracted from, and must find nothing.
- **Copy is config, as whole sentences.** No copy ships with the package. A noun
  alone is not enough: in a gendered language the noun changes the rest of the
  sentence. A sentence that carries a value (a count, a name, a day) is a
  function the host writes, so plurals and word order stay the host's.
- **Ids are config.** Refusal codes, audit action ids, notification type ids and
  permission ids are the host's, so its clients and its stored rows never change.
- **Required config, never defaults.** A missing piece throws a
  `TenantConfigError` naming the key, at startup.
- **The tenant row stays the host's.** The package never maps it; its own tables
  are keyed by an opaque `tenant_id` with no foreign key. `bySlug` resolves the
  tenant's CURRENT slug only; former (kept) slugs go through the slug port,
  `TenantSlugPort`, which the host implements over its own tables.

## Tables

| Table | Rows |
|---|---|
| `tenant_closings` | one per tenant while it is closing, kept once purged; reopening deletes it |
| `tenant_data_exports` | one per export request; at most one `PREPARING` per tenant |

`tenant_closings.prior_status` records the host status a close started from (a
suspended tenant may be closed by the platform), so a reopen restores it. The
actor is `requested_by_id`: a user id, or null for a platform actor with no user
row, so no separate actor column exists. `after_close_done_at` /
`after_close_failed_at` record the host's after-close hook (a billing cancel, for
instance), which the package retries but never names.
