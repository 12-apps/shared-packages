/**
 * The typed JSON API client every screen in the shell goes through.
 *
 * A SPA served same-origin with its backend (path-routed behind a reverse proxy
 * in production, the Vite dev-server proxy in development) needs nothing more
 * than a relative `fetch` with `same-origin` credentials to carry the session
 * cookie. What it DOES need is one place that turns a non-2xx into a throw
 * carrying the status and the parsed body, because that is what every
 * interceptor above it keys on.
 *
 * ## `ApiError`'s shape is a published contract
 *
 * `@12-apps/entitlements`' upsell channel decides whether a rejection is a plan
 * denial by reading `status` and `body` off an `ApiError` — so the three fields
 * below (`name`, `status`, `body`) are load-bearing for an ALREADY-PUBLISHED
 * package, not an implementation detail of this one. They are pinned by
 * `__tests__/api.test.ts` for that reason: a `status` that stopped being a
 * number, or a `body` that stopped being the parsed payload, would turn a 402
 * into an unhandled error in a host that never changed a line.
 */

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Options for {@link apiFetch}; `body` is JSON-serialized automatically. */
export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * The message an error body offers, if any.
 *
 * `error` before `message` because that is the key this org's surfaces answer
 * with (`{ error }` at the top level for a denial — see any `createApi*`
 * package's envelope), and `message` is the fallback for a third-party body.
 */
function extractMessage(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const candidate = record.error ?? record.message;
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

/**
 * Fetch `path` and parse the JSON response, throwing {@link ApiError} on
 * non-2xx statuses (with the parsed error body attached when available).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body; keep null.
    }
    throw new ApiError(response.status, parsed, extractMessage(parsed));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * URL building lives in `./paths` — `joinApiPath` and `stripTrailingSlashes`. It moved
 * there rather than being re-exported from here, because a re-export is a second name
 * for the same thing and the point of that module is that there is exactly ONE
 * implementation of "strip the trailing slashes": the anchored regex it replaces is
 * polynomial ReDoS, and a second copy is how one of them stays that way.
 */
