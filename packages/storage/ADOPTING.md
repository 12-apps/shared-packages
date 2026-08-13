# Adopting @12-apps/storage

This package is a **plug-and-play upload plugin** (12-20): one library, reusable
across repositories, exposing standardized surfaces. A host only *points* at
those surfaces — when the library updates, every host updates with **no app
changes**. The contract is the one `@12-apps/report-builder`, `@12-apps/rbac` and
`@12-apps/payments-*` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/storage` | Nothing to wire — the format allowlist, the ceiling, the object-key grammar, the rendition set, the refusal taxonomy, the URL builders and the wire schemas. Isomorphic: the browser half reads the same constants the server enforces. |
| **Server** | `@12-apps/storage/server` | Call `createApiStorage(config)` and mount the `routes` it returns. Parsing, the streaming cap, the magic-number check, key minting, the rendition write order, status codes and the envelope are all inside. The same object also hands back the write path, the URL builders and the reclaim, so every OTHER host surface stores and resolves through one wiring. |
| **Hono** | `@12-apps/storage/hono` | `const storage = storageRouter({ …config, resolveActor }); app.route('/api', storage.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **S3** | `@12-apps/storage/s3` | `createS3Driver({ bucket, region \| endpoint, … })`. `@aws-sdk/client-s3` is an OPTIONAL peer resolved ONLY here, so a host on local disk never installs it. |
| **React** | `@12-apps/storage/react` | Call `createWebStorage({ apiBase })` and render `page`, drop `ImageField` into a form, or build your own affordance on `useUpload`. |
| **Prisma** | — none | This package owns **no models**. See "Why there is no Prisma partial" below. |

## The five values you must decide, and why none of them defaults

`createApiStorage` requires `driver`, `maxBytes`, `imagePipeline`, `unscopedKeys`
and `references`. The reason is the same for all five and it is not tidiness:
**each one fails quietly when it is wrong.** A loud wrong default gets fixed on
the first deploy. These produce a green deploy, successful uploads, and a
consequence weeks later that no log line explains — so the only place the
decision can be made correctly is the host, in the open, once.

| Config | What a default would cost you, specifically |
|---|---|
| `driver` | Uploads succeed onto a container's ephemeral disk. One container holds the object, the others 404, the next deploy discards it. `writeFile` returned success every time, so nothing is logged. |
| `maxBytes` | Your tool schemas advertise one ceiling and the endpoint enforces another; an agent's upload is refused for a size its own schema accepted. |
| `imagePipeline` | Whether crops exist at all. Discovered from the shape of a key, in production, by a card that renders the uncropped photo. |
| `unscopedKeys` | Whether one tenant's reclaim can reach another tenant's bytes. Wrong in either direction and silent in both. |
| `references` | Whether a restored row still has its photo. `[]` is not "no opinion" — it means *reclaim everything immediately*. |

`logger` is the one that legitimately defaults: a reclaim may only report, never
raise, so the worst a defaulted logger costs is silence. Pass yours anyway.

## Host wiring rules (the ones that bite)

1. **The host resolves WHO and WHERE; the package decides WHAT HAPPENS TO THE
   BYTES.** `resolveActor` answers `{ scope, mayUpload }`. `scope` is the tenant
   the objects belong to — it becomes the key's scope segment, so it must be
   stable for the lifetime of an object (an id, not a renameable slug, unless
   slugs are immutable in your host). `mayUpload` is ONE boolean because two
   independent host questions feed it: "may this person store objects?" (roles,
   memberships, plan) and "may this SESSION change anything?" (a read-only
   impersonation, a maintenance mode). Both are answered before delegating. A
   package that computed either would be wrong for every host but the first.
2. **`unscopedKeys` is a migration decision, and you must make it.** A host with
   existing rows minted before the scope segment passes `'accept'`: such a key
   carries no tenant, so the structural cross-tenant guard cannot apply to it and
   only `references` stands between one tenant and another's objects. A fresh
   host passes `'reject'`, and then every key it will ever touch is scoped.
   There is no default because the wrong one is silent in both directions.
3. **`references` are YOUR tables, and the parameter is REQUIRED.** A key can
   outlive the row that pointed at it, and some of those states are ones a person
   is about to act on — a duplicated row sharing one object, a soft-deleted row
   whose "restore" is expected to bring the photo back, a draft or a pending
   approval holding a key waiting to be published. Deleting the object would break
   the very next thing they do. Each of those is a probe:

   ```ts
   references: [
     { name: 'live-rows', referenced: (scope, key) => rowPointsAt(scope, key) },
     { name: 'pending',   referenced: (scope, key) => draftOrRequestHolds(scope, key) },
   ]
   ```

   Scope each probe to the state that is genuinely PENDING (an `OPEN` draft, a
   `PENDING` request, a `DELETED` bin entry). A probe that matches every row ever
   written quietly restores "nothing is ever reclaimed", one abandoned edit at a
   time. And think hard before adding **version history** as a probe: versioning
   is usually on by default, so counting a version as a reference pins the object
   for the whole retention window and "replace a photo" reclaims nothing, ever.

   `references: []` is a legal answer and you must write it out. It says "nothing
   in this host copies a key", and it is the value that made this parameter
   required: it used to be the DEFAULT, so a host that had never thought about the
   question got *reclaim everything immediately* — and found out weeks later, when
   a store owner restored a product and the row came back without its photo.

   **WHEN to call the reclaim: after commit, and after any copy-on-write path has
   landed.** The probes are read OUTSIDE your transaction, and `deleteIfOrphaned`
   is read-validate-write with no claim-once — it consults every probe, then
   deletes. So there is a window, and it is real:

   1. user B replaces product P's photo; the reclaim probes key `K`, nothing holds it;
   2. concurrently user A duplicates P from a stale tab, and the duplicate row is
      written with `imageKey: K`;
   3. the purge runs. `K` and its five crops are gone, and A's new row points at
      six objects that do not exist.

   Closing that window needs refcounting, which would live in your tables beside
   the keys — it is not something the package can do for you. What you can do is
   order the call so the window is empty: **commit first, then reclaim**, and never
   reclaim from inside a transaction or before a duplicate/restore path has
   written. The package makes the failure discoverable rather than silent: if a
   probe claims the key immediately after the purge, it logs through your `logger`
   naming the probe — which is the only warning you will get, and the reason rule 4
   matters.
4. **`logger` is how you hear about a bucket that stopped accepting deletes.**
   The reclaim runs after the write it follows and can only report, never raise —
   a store owner who successfully changed a photo must not see an error because a
   delete timed out. Pass your feature logger. The default drops everything, and
   note that a bare `console.error` is invisible to some server-side error
   reporters.
5. **`publicPathPrefix` must be the mount plus `STORAGE_PATHS.serve`.** The local
   driver builds display URLs from it, and the serve route answers them. Compose
   it rather than retyping the path, or a deployment writes objects at one path
   and serves them from another.
6. **Static imports only.** This package publishes TypeScript source. A dynamic
   non-literal `import()` of a subpath crashes a bundled server.
7. **Do not add a presigned-URL path in the host either.** The endpoint is
   deliberately the only way bytes arrive from a browser; the reasons are in the
   README and they apply to a host that reintroduces the hop by hand.

## Why there is no Prisma partial

The other plugins in this series own tables. This one owns none, and that is a
finding rather than an omission: everything storage persists is an object in a
bucket or on a disk. The columns that hold a key — `menu_items.image_key`,
`client_branding.logo_key` — are columns on **host** models, and a package that
declared them would be declaring the host's catalog.

The consequence is rule 3: the "is this object still needed?" question cannot be
answered inside the package, so it arrives as predicates over the host's own
tables. There is nothing to sync, no migration to replay, and no
`prisma:sync-*:check` for this package.

## A worked mount (Hono + local disk + sharp)

This is a **fresh host**: no rows predate the scope segment, so `unscopedKeys` is
`'reject'`. See the note after it if that is not you.

Read the `root` line before you copy it. There is **no `??`** on it deliberately:
`process.env.UPLOADS_DIR ?? \`${process.cwd()}/.uploads\`` in this position is
precisely the fail-open default the table above refuses to have, and it is the one
mistake this document used to hand you ready-made.

```ts
import sharp from 'sharp';
import { DEFAULT_MAX_UPLOAD_BYTES, STORAGE_PATHS } from '@12-apps/storage';
import { createLocalDiskDriver, createSharpImagePipeline } from '@12-apps/storage/server';
import { storageRouter } from '@12-apps/storage/hono';

/**
 * Fail at BOOT for a missing value, not at the next deploy.
 *
 * `UPLOADS_DIR` must be a MOUNTED VOLUME. A container path "works" in every test
 * you will run and loses every object the first time the app is redeployed.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (a mounted volume, not a container path)`);
  return value;
}

const storage = storageRouter({
  driver: createLocalDiskDriver({
    root: requireEnv('UPLOADS_DIR'),
    publicPathPrefix: `/api${STORAGE_PATHS.serve}`,
  }),
  maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  imagePipeline: createSharpImagePipeline({ sharp }),
  // A fresh host: every key it will ever mint is scoped, so a key WITHOUT a scope
  // can only be someone else's or nobody's. See rule 2 before changing this.
  unscopedKeys: 'reject',
  // Your tables. `[]` only if you have checked that nothing here copies a key.
  references: [
    { name: 'live-rows', referenced: liveRowHoldsKey },
    { name: 'pending-state', referenced: pendingStateHoldsKey },
  ],
  logger: createFeatureLogger('uploads'),
  resolveActor: async (c) => {
    const actor = await resolveEffectiveActor(c.req.raw);
    if (!actor.tenantId) return null;
    return { scope: actor.tenantId, mayUpload: await mayUpload(actor) };
  },
});

app.route('/api', storage.router);
```

**If your host already has image keys**, they were minted before the scope segment
existed, so they carry no tenant and `'reject'` would refuse to touch every one of
them. Pass `unscopedKeys: 'accept'` instead — and understand what you are taking
on: for those legacy keys the tenant boundary on reclaim is your `references`
probes ALONE, because there is no scope in the key for the structural guard to
check. That makes rule 3 sharper for you than for a greenfield host, not looser.

**In development**, and only there, the `??` is fine — a lost object on a laptop
costs nothing:

```ts
// DEV ONLY. Never in the mount above.
root: process.env.UPLOADS_DIR ?? `${process.cwd()}/.uploads`,
```

Switching to a bucket is a driver swap and nothing else:

```ts
import { createS3Driver } from '@12-apps/storage/s3';

driver: createS3Driver({
  bucket: process.env.S3_BUCKET ?? '',
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,          // Spaces, MinIO, R2…
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
  publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL,   // a CDN in front
}),
```

## Feeding a tool schema without drifting

A host that lets an agent send bytes inside a write needs the same ceiling in
its tool schema. Read **both** fields off the mount, not off a constant:

```ts
const body = z.object({
  imageKey: storage.schemas.objectKey.nullish(),   // grammar === this mount's keyPrefix
  image: storage.schemas.inlineImage.optional(),   // ceiling  === this mount's maxBytes
}).superRefine(refineImageInput);
```

`refineImageInput` refuses a body stating BOTH an existing key and new bytes.
They mean opposite things — "keep pointing at this object" versus "store these
bytes and point at the result" — so silently preferring one discards an upload
the caller cannot see was discarded.

### `imageKey` is not a string field, and this recipe used to say it was

It said `imageKey: z.string().nullish()`, which accepts **any** string. Combine
that with `objectUrl`, which deliberately returns an already-absolute value
unchanged (a documented affordance for a host migrating off a URL column), and an
adopter following this page ends up accepting an arbitrary URL on a write and
rendering it into an `<img src>`:

```ts
updateProduct({ imageKey: 'https://tracker.example/p.png' })
```

Any actor who may edit a product can then make every buyer loading that
storefront page send their IP and user-agent to a third party. No upload, no
bucket and no driver is involved, so **nothing on the storage path can catch
it** — the only place to refuse it is where the value arrives.
`storage.schemas.objectKey` is that refusal, and it is built from the mount's own
`keyPrefix` so it cannot drift from what the mount actually mints.

Two things it does not do, and you may want both:

- **It does not check the tenant.** `products/<otherTenant>/<uuid>/full.webp` is a
  well-formed key, so it parses. The reclaim refuses to delete it (`keyInScope`),
  but it is still a key you never minted sitting in your own catalog, and it makes
  one store display another's photo. Pair the schema with
  `keyInScope(key, scope, unscopedKeys)` in the handler, which the schema cannot do
  because it does not know who is calling.
- **It does not verify the object EXISTS.** A well-formed key for an object that was
  never stored passes; the `<img>` 404s. That is a cheap `driver` read if you care.

For the record, a `javascript:`-shaped value is already inert without the schema —
`objectUrl` only passes through `^https?://`, so it is handed to the driver and
comes back as a path under your mount rather than as an executable href. Inert is
not the same as valid; the schema refuses it too.

## What the host keeps

Config, and nothing else: who is calling, which tenant they act for, where bytes
live, which of its tables can pin an object, the ceiling, and the choice of
pipeline. Everything else — the endpoint, the cap, the byte check, the key
grammar, the crop set, the URLs, the reclaim, the picker, the browser-side
re-encode and every pt-BR sentence — is the package's.

## Not in scope for this package

- **Publishing setup.** A brand-new package's first npm publish and its trusted
  publisher are a manual step for a maintainer.
- **`base-app` adoption.** Mounting this behind an OFF-by-default feature flag in
  `12-apps/base-app` is tracked with the ticket; that repository is not part of
  this change.
