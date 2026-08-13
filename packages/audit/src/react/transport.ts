/**
 * How the audit viewer reaches its data (12-14) — the report-builder transport
 * doctrine: this is the ONLY way the surface performs I/O, so a caller supplying
 * one has substituted the entire backend without stubbing a global. The default
 * is same-origin `fetch` riding the browser's cookies.
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

const FALLBACK_ERROR = 'Não foi possível carregar a auditoria.';

export function httpAuditTransport(): AuditTransport {
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
        throw new AuditRequestError(response.status, payload?.error ?? FALLBACK_ERROR);
      }
      if (payload === null) throw new AuditRequestError(response.status, FALLBACK_ERROR);
      return payload as T;
    },
  };
}
