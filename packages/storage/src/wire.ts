import { z } from 'zod';

import { ACCEPTED_CONTENT_TYPES } from './content-types';
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
