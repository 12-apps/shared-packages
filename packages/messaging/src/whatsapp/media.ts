import { ChannelMediaFailure, type ChannelMedia } from "../core/channel";
import { DEFAULT_META_MEDIA_HOSTS, graphRequest, type FetchResponse, type GraphConfig } from "./graph";

/**
 * A WhatsApp media download, the Cloud API way: `GET /{version}/{media-id}`
 * with the business token answers `{ url, mime_type, file_size }`, and a
 * `GET` of that URL with the same token answers the bytes.
 *
 * The token travels in the Authorization header only, and only to a Meta
 * media host over https: the URL comes from Meta, but it is still checked
 * against the configured hosts before the token is sent to it, and a redirect
 * is refused rather than followed to wherever it points. The size is capped
 * twice — the declared `file_size` before the download, the bytes actually
 * read during it — and the media lives only in the returned memory.
 */

const OCTET_STREAM = "application/octet-stream";

/** Does `host` match one allowlist entry: an exact name, or `*.domain` for its subdomains. */
function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const pattern = entry.toLowerCase();
    // "*.fbcdn.net" matches "x.fbcdn.net" through its ".fbcdn.net" suffix, never "fbcdn.net" or "evilfbcdn.net".
    return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;
  });
}

/** The media URL Meta returned, checked: https, no userinfo, an allowed host. */
function checkedMediaUrl(raw: unknown, allowed: readonly string[]): string {
  if (typeof raw !== "string" || raw === "") throw new ChannelMediaFailure("NO_MEDIA_URL", "Graph returned no media url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ChannelMediaFailure("MEDIA_URL_INVALID", "Graph returned a media url that does not parse");
  }
  if (url.protocol !== "https:") throw new ChannelMediaFailure("MEDIA_URL_REFUSED", "the media url is not https");
  if (url.username || url.password) throw new ChannelMediaFailure("MEDIA_URL_REFUSED", "the media url carries credentials");
  if (!hostAllowed(url.hostname.toLowerCase(), allowed)) {
    throw new ChannelMediaFailure("MEDIA_HOST_REFUSED", `the media host ${url.hostname} is not a Meta media host`);
  }
  return url.toString();
}

const tooLarge = (size: number, maxBytes: number) =>
  new ChannelMediaFailure("TOO_LARGE", `the media is ${size} bytes, over the ${maxBytes}-byte cap`);

/** A declared size over the cap refuses the download before it starts. */
function checkDeclaredSize(declared: unknown, maxBytes: number): void {
  const size = typeof declared === "number" ? declared : typeof declared === "string" ? Number(declared) : NaN;
  if (Number.isFinite(size) && size > maxBytes) throw tooLarge(size, maxBytes);
}

/** Concatenate the chunks read so far. */
function joined(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Read a stream, cancelling it the moment it passes the cap. */
async function readStreamCapped(response: FetchResponse, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(total, maxBytes);
    }
    chunks.push(value);
  }
  return joined(chunks, total);
}

/** The body's bytes, never more than `maxBytes` of them — whatever the headers declared. */
async function readBodyCapped(response: FetchResponse, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers?.get("content-length");
  if (declared) checkDeclaredSize(declared, maxBytes);
  if (response.body && typeof response.body.getReader === "function") return readStreamCapped(response, maxBytes);
  if (!response.arrayBuffer) throw new ChannelMediaFailure("NO_BINARY_BODY", "the fetch port cannot read a binary body");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw tooLarge(bytes.length, maxBytes);
  return bytes;
}

/** GET the media URL with the token in a header; a redirect or a non-2xx is refused. */
async function downloadFrom(graph: GraphConfig, url: string, token: string): Promise<FetchResponse> {
  const response = await graph.fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "*/*" },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new ChannelMediaFailure("REDIRECT_REFUSED", `the media download answered ${response.status}; redirects are not followed`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ChannelMediaFailure(`HTTP_${response.status}`, `the media download answered ${response.status}`);
  }
  return response;
}

/** Download one WhatsApp media object into memory. */
export async function downloadWhatsAppMedia(
  graph: GraphConfig,
  input: { token: string; mediaId: string; maxBytes: number },
): Promise<ChannelMedia> {
  const meta = await graphRequest(graph, {
    method: "GET",
    path: encodeURIComponent(input.mediaId),
    token: input.token,
    redirect: "manual",
  });
  const url = checkedMediaUrl(meta.url, graph.mediaHosts ?? DEFAULT_META_MEDIA_HOSTS);
  checkDeclaredSize(meta.file_size, input.maxBytes);
  const response = await downloadFrom(graph, url, input.token);
  const bytes = await readBodyCapped(response, input.maxBytes);
  const declaredType = typeof meta.mime_type === "string" && meta.mime_type ? meta.mime_type : null;
  const mimeType = declaredType ?? response.headers?.get("content-type") ?? OCTET_STREAM;
  return { bytes, mimeType, size: bytes.length };
}
