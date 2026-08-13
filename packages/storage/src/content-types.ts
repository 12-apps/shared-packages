/**
 * The image formats an upload surface accepts, and the extension each is
 * stored under.
 *
 * One map, because three separate places read it and none of them may
 * disagree: the endpoint validates the declared `Content-Type` against it, the
 * key is minted with the extension it names, and the serve path answers with
 * the type that extension maps back to. A format added on one of those three
 * paths only is a file that uploads and then cannot be read, or reads as the
 * wrong type.
 */

/** Image MIME types an upload accepts, mapped to their file extension. */
export const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Inverse lookup: extension → MIME type (for `Content-Type` response headers). */
export const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXTENSION_BY_CONTENT_TYPE).map(([contentType, extension]) => [
    extension,
    contentType,
  ]),
);

/** The accepted types, as a list — the browser half's `accept` attribute. */
export const ACCEPTED_CONTENT_TYPES: readonly string[] = Object.keys(EXTENSION_BY_CONTENT_TYPE);

/** Is `contentType` one of the formats this surface stores? */
export function isAcceptedContentType(contentType: string): boolean {
  return contentType in EXTENSION_BY_CONTENT_TYPE;
}

/**
 * `image/png; charset=…` → `image/png`, lowercased; `undefined` for anything
 * outside the allowlist.
 *
 * Parsing and allowlisting in one step on purpose: a caller that got the type
 * back but had to check it itself is a caller that can forget to.
 */
export function acceptedContentTypeOf(header: string | null | undefined): string | undefined {
  const raw = header?.split(';')[0]?.trim().toLowerCase();
  return raw && isAcceptedContentType(raw) ? raw : undefined;
}
