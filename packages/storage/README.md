# @12-apps/storage

Image uploads that land at **your own origin**, never at the bucket.

One backend factory, one frontend factory, a driver port with two
implementations, and an image-pipeline port so a native dependency stays the
host's choice.

> **Adopting this?** This README is the API reference; **[`ADOPTING.md`](./ADOPTING.md)**
> is the step-by-step wiring, including the four required config values and why
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

## The four values with no default

`createApiStorage` requires `driver`, `maxBytes`, `imagePipeline` and
`unscopedKeys`. Each safe value is host-specific, so a default would be a
decision made by whoever typed the first host and silently inherited by every one
after it:

| Config | What a default would cost |
| --- | --- |
| `driver` | A container's ephemeral disk in production, reporting every upload as a success and losing the objects at the next deploy. |
| `maxBytes` | Whatever number this file happens to carry, in a host whose tool schemas advertise something else. |
| `imagePipeline` | Whether crops exist at all — discovered from the shape of a key in production. |
| `unscopedKeys` | Whether one tenant's reclaim can reach another tenant's bytes. |

## Backend, in full

```ts
import { createApiStorage } from '@12-apps/storage/server';
import { createLocalDiskDriver, passthroughImagePipeline } from '@12-apps/storage/server';
import { DEFAULT_MAX_UPLOAD_BYTES, STORAGE_PATHS } from '@12-apps/storage';

const storage = createApiStorage({
  driver: createLocalDiskDriver({
    root: process.env.UPLOADS_DIR ?? `${process.cwd()}/.uploads`,
    publicPathPrefix: `/api${STORAGE_PATHS.serve}`,
  }),
  maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  imagePipeline: passthroughImagePipeline(),
  unscopedKeys: 'reject',
});
```

`storage` carries everything else a host needs:

| Member | Use |
| --- | --- |
| `routes` | Framework-neutral descriptors. `@12-apps/storage/hono` mounts them. |
| `limits` | What this mount enforces — feed a tool schema from it, never from a constant of your own. |
| `schemas.inlineImage` | A zod schema whose base64 ceiling **is** `maxBytes`. |
| `storeImage` / `storeInlineImage` | The write path for a host write that carries bytes (an agent's only option). |
| `urls.objectUrl` / `urls.imageSources` / `urls.versionedObjectUrl` | Key → URL, through the active driver. |
| `reclaim.*` | Reclaiming a replaced object, a superseded set, or keys a failed write just minted. |

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
before crops existed. It still verifies the magic number, because that check is
what stops an upload surface being a way to park arbitrary content at a
world-readable URL on the store's own domain.

## A second vendor is a config entry

`createS3Driver` covers every S3-compatible store. AWS needs a `region`;
DigitalOcean Spaces, MinIO, R2 and the rest need an `endpoint`, plus
`forcePathStyle` for the ones that cannot do virtual-hosted addressing. No
branch in the upload path changes, and no host code is written.

Nothing in this package reads `process.env`.
