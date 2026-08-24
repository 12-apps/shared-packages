import type { WebStorageMessageContext, WebStorageMessages } from './failures';

/**
 * The en-US pack — a NAMED factory a host passes by hand, never a default.
 * `limit` is interpolated for the same reason the server pack does it: a host
 * that raises the ceiling must not end up with copy naming the old number.
 */
export function EN_US_WEB_STORAGE_MESSAGES(
  context: WebStorageMessageContext,
): WebStorageMessages {
  return {
    forbidden: 'Your account may not upload images for this store.',
    unsupported_content_type: 'Unsupported format. Send a PNG, JPG, WebP or GIF.',
    file_too_large: `That image is too large. The limit is ${context.limit}.`,
    invalid_key: 'That image could not be found.',
    not_found: 'That image is no longer available.',
    session_expired: 'Your session has expired. Sign in again and repeat the upload.',
    transport: 'Could not reach the server. Check your connection and try again.',
    empty_file: 'Empty file (0 bytes). Pick the image again.',
    file_too_large_upfront: ({ size, limit }) =>
      `That image is too large: ${size}. The limit is ${limit} — shrink it and try again.`,
    unknown_content_type: 'Could not identify the file type. Send a PNG, JPG or WebP.',
    unsupported_content_type_upfront: ({ contentType }) =>
      `Unsupported format (${contentType}). Send a PNG, JPG, WebP or GIF.`,
    missing_key: 'The server accepted the image but returned no key. Try again.',
    upload_failed_http: ({ status, detail }) =>
      `Could not upload that image (HTTP ${status}${detail}). Try again in a moment.`,
    upload_failed: 'Uploading that image failed. Try again in a moment.',

    pageTitle: 'Store images',
    pageIntro: `Send a PNG, JPG, WebP or GIF of up to ${context.limit}.`,
    fieldLabel: 'Product photo',
    fieldHelper: 'The image is resized in the browser before it is sent.',
    fieldRemove: 'Remove image',
    field: {
      // `buttonLabel` is never read here — `ImageField` overrides it with
      // `fieldLabel`. It is still answered, because the type is the whole of
      // what `UploadButton` may render and a partial answer is not a pack.
      buttonLabel: 'Product photo',
      dropzoneHint: 'Drop the image here, or click to choose one',
      dropzoneRole: (label) => `Image upload area. ${label}`,
      uploading: 'Uploading…',
      dropReady: 'Image ready to drop',
      percentUploaded: (percent) => `${percent}% uploaded`,
      uploadInProgress: (percent) => `Upload in progress: ${percent}%`,
      errorAnnouncement: (message) => `Error: ${message}`,
    },
  };
}
