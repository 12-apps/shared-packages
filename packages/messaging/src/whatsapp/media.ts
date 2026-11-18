import { ChannelMediaFailure, DEFAULT_MEDIA_TIMEOUT_MS, isPositiveSafeInteger, type ChannelMedia } from "../core/channel";
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
 * read during it — the whole download has a deadline, and the media lives
 * only in the returned memory.
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
  if (url.port !== "") throw new ChannelMediaFailure("MEDIA_URL_REFUSED", "the media url names an explicit port");
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

/** The download's deadline: one abort signal for both calls, and a race for every read. */
interface Deadline {
  signal: AbortSignal;
  /** `promise`, or a `TIMEOUT` failure once the deadline passes — whichever comes first. */
  race<T>(promise: Promise<T>): Promise<T>;
  clear(): void;
}

const timedOut = (timeoutMs: number) =>
  new ChannelMediaFailure("TIMEOUT", `the media download did not finish within ${timeoutMs} ms`);

function deadlineOf(timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timedOut(timeoutMs));
    }, timeoutMs);
  });
  // The race below observes it; this only keeps an unobserved expiry from being reported unhandled.
  expired.catch(() => undefined);
  return {
    signal: controller.signal,
    race: async (promise) => {
      try {
        return await Promise.race([promise, expired]);
      } catch (error) {
        // A port that honours the signal rejects with its own abort error: it is the deadline all the same.
        throw controller.signal.aborted ? timedOut(timeoutMs) : error;
      }
    },
    clear: () => clearTimeout(timer),
  };
}

/** Release a body that will not be read; never throws. */
function discardBody(response: FetchResponse): void {
  try {
    void Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
  } catch {
    // A body that cannot even be cancelled is left to the garbage collector.
  }
}

/** Read a stream, cancelling it the moment it passes the cap or the deadline. */
async function readStreamCapped(response: FetchResponse, maxBytes: number, deadline: Deadline): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) throw tooLarge(total, maxBytes);
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  return joined(chunks, total);
}

/** The body's bytes, never more than `maxBytes` of them — whatever the headers declared. */
async function readBodyCapped(response: FetchResponse, maxBytes: number, deadline: Deadline): Promise<Uint8Array> {
  const declared = response.headers?.get("content-length");
  if (declared) {
    try {
      checkDeclaredSize(declared, maxBytes);
    } catch (error) {
      discardBody(response);
      throw error;
    }
  }
  if (response.body && typeof response.body.getReader === "function") return readStreamCapped(response, maxBytes, deadline);
  if (!response.arrayBuffer) throw new ChannelMediaFailure("NO_BINARY_BODY", "the fetch port cannot read a binary body");
  // Only for a port with no stream: it reads the WHOLE body before the cap can be checked.
  const bytes = new Uint8Array(await deadline.race(response.arrayBuffer()));
  if (bytes.length > maxBytes) throw tooLarge(bytes.length, maxBytes);
  return bytes;
}

/** GET the media URL with the token in a header; a redirect or a non-2xx is refused, its body discarded. */
async function downloadFrom(graph: GraphConfig, url: string, token: string, deadline: Deadline): Promise<FetchResponse> {
  const response = await deadline.race(
    graph.fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "*/*" },
      redirect: "manual",
      signal: deadline.signal,
    }),
  );
  if (response.status >= 200 && response.status < 300) return response;
  discardBody(response);
  if (response.status >= 300 && response.status < 400) {
    throw new ChannelMediaFailure("REDIRECT_REFUSED", `the media download answered ${response.status}; redirects are not followed`);
  }
  throw new ChannelMediaFailure(`HTTP_${response.status}`, `the media download answered ${response.status}`);
}

/** A cap or deadline that would not bound anything (NaN, Infinity, 0, negative, fractional) is refused. */
function checkLimits(maxBytes: number, timeoutMs: number): void {
  if (!isPositiveSafeInteger(maxBytes) || !isPositiveSafeInteger(timeoutMs)) {
    throw new ChannelMediaFailure("BAD_OPTIONS", "maxBytes and timeoutMs must be positive safe integers");
  }
}

/** Download one WhatsApp media object into memory. */
export async function downloadWhatsAppMedia(
  graph: GraphConfig,
  input: { token: string; mediaId: string; maxBytes: number; timeoutMs?: number },
): Promise<ChannelMedia> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS;
  checkLimits(input.maxBytes, timeoutMs);
  const deadline = deadlineOf(timeoutMs);
  try {
    const meta = await deadline.race(
      graphRequest(graph, {
        method: "GET",
        path: encodeURIComponent(input.mediaId),
        token: input.token,
        redirect: "manual",
        signal: deadline.signal,
      }),
    );
    const url = checkedMediaUrl(meta.url, graph.mediaHosts ?? DEFAULT_META_MEDIA_HOSTS);
    checkDeclaredSize(meta.file_size, input.maxBytes);
    const response = await downloadFrom(graph, url, input.token, deadline);
    const bytes = await readBodyCapped(response, input.maxBytes, deadline);
    const declaredType = typeof meta.mime_type === "string" && meta.mime_type ? meta.mime_type : null;
    const mimeType = declaredType ?? response.headers?.get("content-type") ?? OCTET_STREAM;
    return { bytes, mimeType, size: bytes.length };
  } finally {
    deadline.clear();
  }
}
