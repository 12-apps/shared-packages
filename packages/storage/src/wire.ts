import { z } from 'zod';

import { ACCEPTED_CONTENT_TYPES } from './content-types';
import { DEFAULT_KEY_PREFIX, isObjectKey } from './keys';
import { maxBase64Length } from './limits';

/**
 * The wire shapes, as zod — including the one a TOOL schema is built from.
 *
 * `inlineImageSchema(maxBytes)` is a factory rather than a constant because its
 * ceiling IS the mount's ceiling. That is the whole anti-drift point of the
 * extraction: a host builds its agent-facing tool schema from
 * `createApiStorage(…).schemas.inlineImage`, so the schema cannot advertise a
 * limit the endpoint does not enforce, and raising one raises the other.
 */

/** An image supplied by VALUE, base64-encoded because a tool call is JSON. */
export function inlineImageSchema(
  maxBytes: number,
): z.ZodObject<{ contentType: z.ZodEnum<Record<string, string>>; contentBase64: z.ZodString }> {
  return z.object({
    contentType: z.enum(
      Object.fromEntries(ACCEPTED_CONTENT_TYPES.map((type) => [type, type])),
    ),
    /** The file's bytes, base64-encoded. A `data:` URL prefix is accepted. */
    contentBase64: z.string().min(1).max(maxBase64Length(maxBytes)),
  });
}

/** An image supplied by value: `{ contentType, contentBase64 }`. */
export interface InlineImage {
  contentType: string;
  contentBase64: string;
}

/**
 * A key this scheme actually minted — the schema an `imageKey` FIELD should use.
 *
 * Ships beside {@link inlineImageSchema} because the pair is what a host's write
 * body is made of, and because `z.string()` is the wrong answer in a way that is
 * not obvious. An `imageKey` is not free text: it is a key the server minted, it is
 * rendered straight into an `<img src>` by `objectUrl`, and `objectUrl`
 * deliberately returns an ALREADY-ABSOLUTE value unchanged (a documented migration
 * affordance for a host moving off a URL column).
 *
 * Compose those two and a recipe that accepts any string accepts
 * `imageKey: 'https://tracker.example/p.png'` from anyone who may edit the row —
 * after which every buyer loading that storefront page sends their IP and
 * user-agent to a third party. No upload, no bucket and no driver is involved, so
 * nothing on the storage path can catch it; the only place to refuse it is where
 * the value arrives.
 *
 * The cross-tenant variant (`products/<otherTenant>/<uuid>/full.webp`) parses here
 * and is refused later by the reclaim's `keyInScope` — but a host that wants it
 * refused on the WRITE should pair this with `keyInScope(key, scope, …)`, which
 * this schema cannot do because it does not know the caller.
 *
 * A `javascript:`-shaped value is already inert: `objectUrl` only passes through
 * `^https?://`, so `javascript:alert(1)` is handed to the driver and comes back as
 * a path under the mount. Inert is not the same as valid, and it is refused here too.
 */
export function objectKeySchema(prefix: string = DEFAULT_KEY_PREFIX): z.ZodString {
  return z.string().refine((key) => isObjectKey(key, prefix), {
    message: 'Not an object key minted by this storage mount.',
  });
}

/** The pair of fields an image-bearing write body carries. */
export interface ImageFields {
  imageKey?: string | null;
  image?: InlineImage;
}

/**
 * Reject a body stating BOTH an existing key and new bytes.
 *
 * Silently preferring one makes the other's presence a no-op the caller cannot
 * see, and the two mean opposite things — "keep pointing at this object" versus
 * "store these bytes and point at the result". An explicit refusal is the only
 * reading that cannot quietly discard an upload.
 */
export function refineImageInput(
  value: ImageFields,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[] = [],
): void {
  if (value.image && value.imageKey) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'image'],
      message:
        'Send either imageKey (an object already stored) or image (the bytes to store), not both.',
    });
  }
}

/** What `POST <mount>/uploads/image` answers on success. */
export const uploadAcceptedSchema = z.object({
  data: z.object({ imageKey: z.string() }),
});

/** The success body of an upload, as the browser half parses it. */
export type UploadAccepted = z.infer<typeof uploadAcceptedSchema>;
