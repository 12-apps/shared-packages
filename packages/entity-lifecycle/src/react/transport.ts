/**
 * How the lifecycle screens reach their data (12-17) — the report-builder
 * transport doctrine: this is the ONLY way the surface performs I/O, so a
 * caller supplying one has substituted the entire backend without stubbing a
 * global. The default is same-origin `fetch` riding the browser's cookies.
 */

/** A write outcome the screens branch on — never a thrown mutation. */
export type LifecycleResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A failed read, carrying the status the screens branch on (403 = feature off). */
export class LifecycleHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LifecycleHttpError';
    this.status = status;
    Object.setPrototypeOf(this, LifecycleHttpError.prototype);
  }
}

export interface LifecycleTransport {
  /** A read. Returns the whole JSON payload (envelope included). */
  get<T>(path: string): Promise<T>;
  /** A write. Returns a {@link LifecycleResult} rather than rejecting. */
  send<T>(path: string, method: string, body?: unknown): Promise<LifecycleResult<T>>;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new LifecycleHttpError(
      response.status,
      payload?.error ?? `HTTP ${response.status} for ${path}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * @param fallbackError What a failed write says when the server sent no
 * sentence of its own — REQUIRED, the host's words. `createWebEntityLifecycle`
 * already passes its (equally required) `copy.operationFailed`; only a host
 * constructing the transport directly writes it here. The old default was one
 * application's Portuguese, and the only string in this file the required-copy
 * port did not cover.
 */
export function httpLifecycleTransport(fallbackError: string): LifecycleTransport {
  return {
    get: readJson,
    async send<T>(path: string, method: string, body?: unknown): Promise<LifecycleResult<T>> {
      try {
        const response = await fetch(path, {
          method,
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.status === 204) return { ok: true, data: undefined as T };
        const payload = (await response.json().catch(() => null)) as
          | { data?: T; error?: string }
          | null;
        if (!response.ok) {
          return { ok: false, error: payload?.error ?? fallbackError };
        }
        return { ok: true, data: (payload?.data ?? payload) as T };
      } catch {
        return { ok: false, error: fallbackError };
      }
    },
  };
}
