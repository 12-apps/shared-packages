/**
 * How the audit viewer reaches its data — this is the ONLY way the surface
 * performs I/O, so a caller supplying one has substituted the entire backend
 * without stubbing a global. The default is same-origin `fetch` riding the
 * browser's cookies.
 */

export interface AuditTransport {
  /** A read. Returns the whole JSON payload (envelope included). */
  get<T>(path: string): Promise<T>;
}

/** The error a failed read rejects with, carrying the status the wire chose. */
export class AuditRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuditRequestError';
    this.status = status;
    Object.setPrototypeOf(this, AuditRequestError.prototype);
  }
}

/**
 * The sentence a failed read reports when the SERVER sent none.
 *
 * English, and a parameter rather than a constant: this string reaches a user,
 * so it is the host's copy. `createWebAudit` passes `labels.requestFailed`,
 * which is where a host has already put the rest of its screen's words — the
 * transport used to hold one hard-coded sentence in the extraction origin's
 * market language, unreachable by any override the config offered.
 */
const FALLBACK_ERROR = 'Could not load the audit trail.';

export interface AuditTransportOptions {
  /** What a failure reports when the server named no reason. */
  fallbackMessage?: string;
}

export function httpAuditTransport(options: AuditTransportOptions = {}): AuditTransport {
  const fallback =
    typeof options.fallbackMessage === 'string' && options.fallbackMessage.trim() !== ''
      ? options.fallbackMessage
      : FALLBACK_ERROR;
  return {
    async get<T>(path: string): Promise<T> {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as
        | (T & { error?: string })
        | null;
      if (!response.ok) {
        // The server's own message wins: a 403 from the permission gate says
        // something a generic "could not load" cannot.
        throw new AuditRequestError(response.status, payload?.error ?? fallback);
      }
      if (payload === null) throw new AuditRequestError(response.status, fallback);
      return payload as T;
    },
  };
}
