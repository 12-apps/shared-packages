import { STORAGE_PATHS } from '../paths';

/**
 * The one request an upload makes, sent two ways.
 *
 * `XMLHttpRequest` by default, because it is the only browser API that reports
 * how many bytes of a request BODY have gone up (`upload.onprogress`); `fetch`
 * reports none, which is why the hook used to know only "uploading". A host's own
 * `fetchImpl` still wins when given — the request is the same either way: one
 * `POST` of the raw file with its `content-type`, to the package's own path on
 * the app's own origin, answered with `{ data: { imageKey } }`.
 */

/** How a send ended, before the answer is read. */
export type SendOutcome =
  | { kind: 'response'; response: Response }
  | { kind: 'transport' }
  | { kind: 'aborted' };

export interface XhrSendHooks {
  /** Bytes of the body sent so far, out of `total`. */
  onProgress: (loaded: number, total: number) => void;
  /** The body is fully sent; the answer has not come yet. */
  onSent: () => void;
}

/** `apiBase` + the upload path + the host's `query`, each key and value URL-encoded. */
export function uploadEndpoint(apiBase: string, query?: Record<string, string>): string {
  const path = `${apiBase.replace(/\/$/, '')}${STORAGE_PATHS.upload}`;
  const pairs = Object.entries(query ?? {}).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );
  return pairs.length > 0 ? `${path}?${pairs.join('&')}` : path;
}

/** Statuses whose `Response` may not carry a body (the constructor throws on one). */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function responseOf(xhr: XMLHttpRequest): Response | null {
  // `Response` accepts 200–599 only; anything else never was an HTTP answer.
  if (xhr.status < 200 || xhr.status > 599) return null;
  const body = NULL_BODY_STATUSES.has(xhr.status) ? null : xhr.responseText;
  const type = xhr.getResponseHeader('content-type');
  return new Response(body, { status: xhr.status, headers: type ? { 'content-type': type } : {} });
}

/**
 * Send with an XHR the caller made (so a test can hand in a fake: jsdom fires no
 * upload events). Resolves, never rejects: every ending is a {@link SendOutcome}.
 * Wrapping the answer as a `Response` keeps ONE refusal mapping
 * (`uploadFailure`) for both transports.
 */
export function sendWithXhr(
  xhr: XMLHttpRequest,
  url: string,
  file: File,
  hooks: XhrSendHooks,
): Promise<SendOutcome> {
  return new Promise((resolve) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) hooks.onProgress(event.loaded, event.total);
    };
    xhr.upload.onload = () => hooks.onSent();
    xhr.onload = () => {
      const response = responseOf(xhr);
      resolve(response ? { kind: 'response', response } : { kind: 'transport' });
    };
    xhr.onerror = () => resolve({ kind: 'transport' });
    xhr.ontimeout = () => resolve({ kind: 'transport' });
    xhr.onabort = () => resolve({ kind: 'aborted' });
    xhr.send(file);
  });
}

/** Send with `fetch` (a host's `fetchImpl`): no byte progress, same request. */
export async function sendWithFetch(
  request: typeof fetch,
  url: string,
  file: File,
  signal: AbortSignal,
): Promise<SendOutcome> {
  try {
    const response = await request(url, {
      method: 'POST',
      // The raw file, not base64 or multipart: the server reads the bytes
      // straight off the stream against its own cap, and the type it stores the
      // object as is this header.
      headers: { 'content-type': file.type },
      body: file,
      signal,
    });
    return { kind: 'response', response };
  } catch {
    return signal.aborted ? { kind: 'aborted' } : { kind: 'transport' };
  }
}
