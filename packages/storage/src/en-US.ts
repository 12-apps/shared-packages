import type { StorageMessageContext, StorageMessages } from './problems';

/**
 * The en-US pack — a NAMED factory a host passes by hand
 * (`messages: EN_US_STORAGE_MESSAGES`), never a default. The filename is what
 * exempts this file from the copy-portability gate, as `pt-BR.ts` beside it is
 * exempt.
 *
 * `limit` is interpolated rather than hard-coded, for the reason the pt-BR pack
 * gives: a host that raises `maxBytes` must not end up with a message naming
 * the old number, which is the single commonest way this kind of copy goes
 * stale. A translation that inlined the number would reintroduce exactly that.
 */
export function EN_US_STORAGE_MESSAGES(context: StorageMessageContext): StorageMessages {
  return {
    invalid_base64: 'That image is not correctly base64-encoded.',
    empty_file: 'That image is empty.',
    file_too_large: `That image is larger than the ${context.limit} limit.`,
    content_mismatch:
      'The image contents do not match the format you declared. Send a PNG, JPEG, WebP or GIF.',
    unsupported_content_type: 'Unsupported format. Send a PNG, JPG, WebP or GIF.',
    image_unreadable: 'That image could not be read — the file appears to be corrupted.',
    image_dimensions_too_large: 'That image is too large in dimensions to process.',
    storage_not_configured: 'Image storage has not been set up for this store yet.',
    storage_unavailable: 'That image could not be saved right now. Try again in a moment.',
  };
}

/** The 401 the mounted router answers when the host resolves no actor. */
export const EN_US_STORAGE_UNAUTHENTICATED = 'Not authenticated.';
