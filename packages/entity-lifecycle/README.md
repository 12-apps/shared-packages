# @12-apps/entity-lifecycle

Generic, portable entity-lifecycle machinery — designed to be lifted into any
project. Framework-free core, zero runtime dependencies, storage via adapters.

Four features, each plug-and-play per collection:

| Feature | What it gives you |
| --- | --- |
| **Versioning** | Diff-based history (only changed fields stored), restore to any version, retention policies (max count / max age) with safe compaction, `publishedVersion` mirroring |
| **Recycle bin** | Soft delete with a tree registry of dependents, restore / permanent-delete |
| **Drafts** | One unpublished working copy per item (or of a brand-new item), publish/discard |
| **Approvals** | Writes by non-approvers become pending change requests; approvers apply/reject |

Versioning, drafts and approvals are **feature-flaggable per tenant** through a
three-layer gate; the recycle bin is always on once a collection is plugged in.

## The plug-and-play surfaces (12-17)

The core below is the kernel; a host normally adopts the whole surface
instead of wiring it:

- `@12-apps/entity-lifecycle/server` — `createApiEntityLifecycle({ db,
  entities, directory })`: the versions / restore / drafts / recycle-bin /
  approvals endpoints, GENERATED per registered collection from one
  declaration each, over the four tables the package owns.
- `@12-apps/entity-lifecycle/hono` — `entityLifecycleRouter({ ...config,
  resolveActor })`, a one-call mount (`hono` is an optional peer).
- `@12-apps/entity-lifecycle/react` — `createWebEntityLifecycle({ apiBase })`:
  the Lixeira + Aprovações page, plus the `VersionHistoryDialog` and
  `DraftBanner` a host drops into its own editors.
- `@12-apps/entity-lifecycle/mcp` — `lifecycleMcpEndpoints({ collectionPath,
  noun, summaries })`: the same eight capabilities described for an AGENT,
  one call per collection. The routes above were already generated from one
  declaration each; their MCP descriptors were the part a host still wrote out
  once per collection. The shape is the package's, the summaries stay the
  host's (`@12-apps/mcp` and `zod` are optional peers).
- `prisma/entity-lifecycle.prisma` + `prisma/migrations/*` — the model
  partial and its migrations, COPIED into the host by `prisma:sync` and the
  host's plugin-migration sync.

The full adoption contract — config tables, endpoint list, the rules that
bite, and the notes for a host that already has these tables — is in
[ADOPTING.md](./ADOPTING.md).

## Concepts

### Snapshots and diffs

An entity is versioned as a `Snapshot` — a JSON map of its top-level fields
(nested values allowed). Version 1 stores the FULL snapshot; each later version
stores only the top-level fields that changed (`data`) and the fields removed
(`removedFields`). The state at version N is rebuilt by replaying rows 1..N
(`materializeVersion`). Retention pruning folds the pruned prefix into the
oldest surviving row (promoted to a full snapshot), so the chain is always
replayable.

### Three-layer feature gate

```
enabled = code (collection opted in)
       && plan (tenant is ENTITLED — what they pay for)
       && tenant (the tenant kept it ENABLED — never forced)
```

The host resolves the two tenant layers per request and passes them in via
`LifecycleContext`; the library never reads tenant state itself.

**Relationship to `@12-apps/entitlements` (FUT-278, a documented decision):**
`resolveFeature` deliberately stays here, dependency-free and synchronous,
rather than migrating onto `@12-apps/entitlements`' `resolveEntitlement` — that
resolver is its strict generalization (quotas, overrides, a status layer), with
identical layer order, reason strings and untouched-toggle defaults on the
boolean subset. Migrating would buy no observable behavior while forcing an
async engine into the kernel's sync guards and flipping lifecycle-write
denials from their 403 onto the engine's 402 upsell path. The equality that
makes standalone safe is pinned by
`apps/web/lib/entitlements/__tests__/resolver-drift.test.ts`; the host bridges
the two states in `apps/web/lib/entitlements/index.ts` (the FUT-326
comped-grant union).

### Schema changes vs restore (the rollback posture)

Versions store loose JSON, deliberately decoupled from the live schema. On
restore, the HOST's `applySnapshot` converts the stored snapshot back into its
current write model — dropping unknown/stale fields, defaulting missing ones,
and re-validating references. The current schema always wins; an old snapshot
can never write a column that no longer exists. Never point migration tooling
at these tables' payloads.

## Plugging in a collection

```ts
import {
  createEntityLifecycle,
  type EntityOps,
  type LifecycleStores,
} from '@12-apps/entity-lifecycle';

const productOps: EntityOps = {
  readSnapshot: async (tenantId, id) => /* live state or null */,
  applySnapshot: async (tenantId, idOrNull, snapshot) => /* create/update; return id */,
  archive: async (tenantId, id) => /* soft-hide; boolean */,
  unarchive: async (tenantId, id) => /* undo archive; boolean */,
  hardDelete: async (tenantId, id) => /* permanent */,
  collectChildren: async (tenantId, id) => /* dependents for the bin tree */,
  onVersionRecorded: async (tenantId, id, version) => /* mirror publishedVersion */,
};

export const products = createEntityLifecycle(
  {
    entityType: 'product',
    features: { versioning: true, drafts: true, approvals: true },
    featureDefaults: { approvals: false }, // entitled ⇒ on, except approvals
    label: (s) => String(s.name ?? ''),
    diff: { ignoreFields: ['updatedAt'] },
    retention: { maxVersions: 50, maxAgeDays: 365 },
  },
  stores, // LifecycleStores: your DB-backed adapters (or the in-memory ones)
  productOps,
);
```

Every mutation then funnels through the service:

```ts
const ctx = { tenantId, actorId, entitlements, settings, canApprove };

await products.create(ctx, snapshot);        // → { status: 'applied' | 'pending-approval' }
await products.update(ctx, id, snapshot);    // records a diff version
await products.softDelete(ctx, id);          // archive + recycle-bin tree
await products.history(ctx, id);             // newest-first summaries
await products.restoreVersion(ctx, id, 3);   // replay 1..3, apply, record RESTORE
await products.restoreDeleted(ctx, entryId); // un-archive from the bin
await products.purgeDeleted(ctx, entryId);   // permanent delete
await products.saveDraft(ctx, id, data);     // or (ctx, null, data) for a new item
await products.publishDraft(ctx, draftId);
await products.approveChange(ctx, requestId); // requires ctx.canApprove
```

`canApprove` is the host's RBAC decision (e.g. a `products:approve`
permission). When approvals are active and `canApprove !== true`, create /
update / delete / restore / publish all park as pending change requests.

## Storage adapters

**The DB-backed adapters ship with the package**: pass any client satisfying
the structural `LifecycleDb` seam (a Prisma client does directly) to
`createDbLifecycleStores(db)` from `@12-apps/entity-lifecycle/server` — or let
`createApiEntityLifecycle` build them for you. **The Prisma models and their
migrations ship too**: `prisma/entity-lifecycle.prisma` is the canonical
partial for the four generic tables (`entity_versions`, `recycle_bin_entries`,
`entity_drafts`, `change_requests`); `pnpm --filter @12-apps/entity-lifecycle
prisma:sync` copies it into a multi-file schema folder (with a `--check` drift
gate for CI), and the migrations under `prisma/migrations/` are discovered
structurally by the host's plugin-migration sync. The partial is
host-agnostic: tenancy is a by-value `client_id` scalar (add an FK in your own
migration if you want one) and closed sets are Strings with CHECK constraints
in the shipped migration. For a custom store, implement `VersionStore`,
`RecycleBinStore`, `DraftStore`, `ApprovalStore`; in-memory implementations
ship for tests/prototyping: `createMemoryVersionStore()` etc.

## Testing

```
pnpm --filter @12-apps/entity-lifecycle test
```
