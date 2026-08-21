/**
 * How the RBAC screens reach their data (12-13) — the report-builder
 * transport doctrine: this is the ONLY way the surface performs I/O, so a
 * caller supplying one has substituted the entire backend without stubbing a
 * global. The default is same-origin `fetch` riding the browser's cookies.
 */

/** A write outcome the forms branch on — never a thrown mutation. */
export type RbacResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface RbacTransport {
  /** A read. Returns the whole JSON payload (envelope included). */
  get<T>(path: string): Promise<T>;
  /** A write. Returns a {@link RbacResult} rather than rejecting. */
  send<T>(path: string, method: string, body?: unknown): Promise<RbacResult<T>>;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return (await response.json()) as T;
}

/**
 * @param fallbackError What a failed write says when the server sent no
 * sentence of its own — REQUIRED, the host's words. `createWebRbac` already
 * passes its (equally required) `copy.operationFailed`; only a host
 * constructing the transport directly writes it here. The old default was one
 * application's Portuguese, and the only string in this file the required-copy
 * port did not cover.
 */
export function httpRbacTransport(fallbackError: string): RbacTransport {
  return {
    get: readJson,
    async send<T>(path: string, method: string, body?: unknown): Promise<RbacResult<T>> {
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
