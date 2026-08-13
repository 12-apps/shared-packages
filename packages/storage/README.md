# @12-apps/storage

Image uploads that land at **your own origin**, never at the bucket.

One backend factory, one frontend factory, a driver port with two
implementations, and an image-pipeline port so a native dependency stays the
host's choice.

> **Adopting this?** This README is the API reference; **[`ADOPTING.md`](./ADOPTING.md)**
> is the step-by-step wiring, including the five required config values and why
> each of them has no default.

## The rule the whole package is built around

**The browser POSTs its bytes to the app server. There is no presigned-URL
mode, and there must never be one.**

A presigned bucket URL makes a working upload depend on the bucket's **CORS
rules** — configuration that lives in neither this repository nor any deploy it
runs. A `PUT` carrying a `Content-Type` is never a "simple" request, so the
browser sends an `OPTIONS` preflight first; a freshly created bucket answers it
with `403` and no `Access-Control-Allow-*` headers, and the upload is never
sent. What makes that failure mode particularly bad:

- **The server sees nothing.** No request ever arrives — no log line, no error
  rate, no 5xx.
- **The browser will not say why.** A blocked cross-origin fetch is deliberately
  indistinguishable from an offline network at the `fetch` layer.
- **The person who sees it cannot fix it.** The message reaches a store owner,
  about a bucket only an operator can configure.

A second reason it cannot come back: a stored photo is a **set** of objects the
server derives from the bytes, so an upload the server never sees cannot produce
one.

## Subpath exports

| Import | Contents |
| --- | --- |
| `@12-apps/storage` | Isomorphic core: format allowlist, upload ceiling, object-key grammar, rendition set, refusal taxonomy, URL builders, wire schemas. |
| `@12-apps/storage/server` | `createApiStorage(config)`, the driver port, the local-disk driver, the image-pipeline port with both implementations, the reclaim. |
| `@12-apps/storage/hono` | `storageRouter({ …config, resolveActor })` — a one-call mount. `hono` is an OPTIONAL peer. |
| `@12-apps/storage/s3` | `createS3Driver(config)` for every S3-compatible vendor. `@aws-sdk/client-s3` is an OPTIONAL peer, resolved only here. |
| `@12-apps/storage/react` | `createWebStorage({ apiBase })` — the bound picker, the preview, the upload hook, the browser-side re-encode. |

The exports map points at `./src` directly — no build step is required at
runtime.

## The two endpoints

```
POST <mount>/uploads/image      raw bytes in, { data: { imageKey } } out
GET  <mount>/uploads/local/…    the object back, or a redirect to where it lives
```

The serve route has two behaviours and the **driver** decides which: a driver
that keeps its own bytes implements `read` and the route streams them; a
bucket-backed driver does not, and the route redirects to `publicUrl`. That used
to be an environment flag read inside the route — the same fact in a second
place, free to disagree with the driver actually in use.

## What a stored photo is

```
products/<scope>/<uuid>/full.webp        the whole picture — the zoom
products/<scope>/<uuid>/card-320.webp    4:3, a card on a phone
products/<scope>/<uuid>/card-640.webp    4:3, a retina card / a phone hero
products/<scope>/<uuid>/card-1280.webp   4:3, a retina hero on a desktop
products/<scope>/<uuid>/thumb-128.webp   1:1, a 64px row thumbnail
products/<scope>/<uuid>/thumb-256.webp   1:1, the same row at 2×
```

The key saved on the row names the uncropped member, and **the key's shape is
what says the crops exist**: `…/<uuid>/full.<ext>` has them, the flat
`…/<uuid>.<ext>` does not. Nothing else records it — no column, and therefore
nothing to keep in step across the draft, the change request, the recycle-bin
snapshot and the version history a row is copied into.

`<scope>` is the tenant. It is what makes cross-tenant reclaim a parse rather
than a query: a reclaim refuses a key whose scope is not the caller's *before*
consulting any reference probe. A scheme without it can only answer "may this
tenant delete this object?" by proving no row of **theirs** points at it — which
is true of every other tenant's objects too.

## The five values with no default

`createApiStorage` requires `driver`, `maxBytes`, `imagePipeline`,
`unscopedKeys` and `references`. Each safe value is host-specific, so a default
would be a decision made by whoever typed the first host and silently inherited
by every one after it — and each of these fails **quietly**, which is the actual
argument. A loud wrong default gets fixed on the first deploy; these do not:

| Config | What a default would cost |
| --- | --- |
| `driver` | A container's ephemeral disk in production, reporting every upload as a success and losing the objects at the next deploy. |
| `maxBytes` | Whatever number this file happens to carry, in a host whose tool schemas advertise something else. |
| `imagePipeline` | Whether crops exist at all — discovered from the shape of a key in production. |
| `unscopedKeys` | Whether one tenant's reclaim can reach another tenant's bytes. |
| `references` | Whether a restored row still has its photo. `[]` is not neutral: it means *reclaim everything immediately*. |

`logger` still defaults, and it is the one that legitimately can: a reclaim may
only report, never raise, so the worst a defaulted logger costs is silence.
`references` defaulted too, until it didn't — because its default **destroys**.

## Backend, in full

**Note the absence of `??`.** Every value below either comes from the
environment and must be there, or is written out. That is deliberate: a
`process.env.UPLOADS_DIR ?? \`${process.cwd()}/.uploads\`` in this position is
exactly the fail-open default the table above refuses to have. `UPLOADS_DIR`
unset in production means uploads succeed, one container holds the object, the
other 404s half the `<img>` requests, and the next deploy discards both — with
nothing in any log, because `writeFile` succeeded every time.

```ts
import { createApiStorage } from '@12-apps/storage/server';
import { createLocalDiskDriver, passthroughImagePipeline } from '@12-apps/storage/server';
import { DEFAULT_MAX_UPLOAD_BYTES, STORAGE_PATHS } from '@12-apps/storage';

/** Fail at BOOT for a missing value, rather than at the next deploy. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — it must be a MOUNTED VOLUME, not a container path.`);
  return value;
}

const storage = createApiStorage({
  driver: createLocalDiskDriver({
    root: requireEnv('UPLOADS_DIR'),
    publicPathPrefix: `/api${STORAGE_PATHS.serve}`,
  }),
  maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  imagePipeline: passthroughImagePipeline(),
  // 'reject' because this host is fresh: every key it will ever mint is scoped, so
  // a key without a scope can only be someone else's or nobody's. A host with rows
  // that predate the scope segment passes 'accept' — see ADOPTING.md rule 2.
  unscopedKeys: 'reject',
  // Which of YOUR tables can still need an object after the row stopped pointing at
  // it. `[]` says "nothing here copies a key" — write it only if you have checked.
  references: [
    { name: 'live-rows', referenced: (scope, key) => rowPointsAt(scope, key) },
  ],
});
```

For **development** the `??` is fine, and only here, because a lost object on a
laptop costs nothing:

```ts
// DEV ONLY. Never in the block above.
root: process.env.UPLOADS_DIR ?? `${process.cwd()}/.uploads`,
```

`storage` carries everything else a host needs:

| Member | Use |
| --- | --- |
| `routes` | Framework-neutral descriptors. `@12-apps/storage/hono` mounts them. |
| `limits` | What this mount enforces — feed a tool schema from it, never from a constant of your own. |
| `schemas.inlineImage` | A zod schema whose base64 ceiling **is** `maxBytes`. |
| `schemas.objectKey` | The schema for an `imageKey` field. **Not `z.string()`** — see below. |
| `storeImage` / `storeInlineImage` | The write path for a host write that carries bytes (an agent's only option). |
| `urls.objectUrl` / `urls.imageSources` / `urls.versionedObjectUrl` | Key → URL, through the active driver. |
| `reclaim.*` | Reclaiming a replaced object, a superseded set, or keys a failed write just minted. |

### An `imageKey` field is not a string field

`objectUrl` returns an already-absolute value **unchanged** — a deliberate
affordance for a host migrating off a URL column. So a write body that accepts
`imageKey: z.string()` accepts `https://tracker.example/p.png`, and every buyer
loading that storefront page then sends their IP and user-agent to a third
party. No upload, no bucket and no driver is involved, so nothing on the storage
path can catch it. Use the mount's own schema:

```ts
const body = z.object({
  imageKey: storage.schemas.objectKey.nullish(),
  image: storage.schemas.inlineImage.optional(),
}).superRefine(refineImageInput);
```

## Frontend, in full

```ts
import { createWebStorage } from '@12-apps/storage/react';

const storage = createWebStorage({ apiBase: '/api' });
// storage.page        a standalone upload surface
// storage.ImageField  the field a form drops in — a key comes out
// storage.useUpload   the primitive, for a bespoke affordance
```

## The image pipeline is a port

Image processing means a native module, and a native module is build surface
every consumer would pay for on every deploy whether or not it wants crops. So
`sharp` is neither a dependency nor a peer here: a host that has it passes the
module in.

```ts
import sharp from 'sharp';
import { createSharpImagePipeline } from '@12-apps/storage/server';

imagePipeline: createSharpImagePipeline({ sharp });
```

`passthroughImagePipeline()` is the other choice: the bytes are stored as they
arrived, no crops, flat keys — which is exactly what every catalog image was
before crops existed.

**The magic-number check is not the pipeline's job**, and this README used to say
it was. It belongs to the WRITER: `storeImage` verifies the bytes against the
declared type as its first statement, before any pipeline sees them. That
placement is deliberate, because the two implementations cannot both be trusted
with it — `passthrough` verifies as part of doing nothing, while `sharp` cannot:
"did libvips decode this" and "is this the format that was declared" are
different questions, and libvips decodes plenty of formats this allowlist
excludes. Putting the check in the writer means no path to storage goes around
it, whichever pipeline a host injected and whether the bytes arrived at the
endpoint, base64 inside a write, or through a direct `storeImage` call.

## A second vendor is a config entry

`createS3Driver` covers every S3-compatible store. AWS needs a `region`;
DigitalOcean Spaces, MinIO, R2 and the rest need an `endpoint`, plus
`forcePathStyle` for the ones that cannot do virtual-hosted addressing. No
branch in the upload path changes, and no host code is written.

Nothing in this package reads `process.env`.
