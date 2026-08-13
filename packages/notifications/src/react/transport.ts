/**
 * How the notification screens reach their data (12-15) — the report-builder
 * transport doctrine: this is the ONLY way the surface performs I/O, so a
 * caller supplying one has substituted the entire backend without stubbing a
 * global. The default is same-origin `fetch` riding the browser's cookies.
 */

/** A write outcome the screens branch on — never a thrown mutation. */
export type NotificationsResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A failed read, carrying the status the screens branch on (401 = signed out). */
export class NotificationsHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NotificationsHttpError';
    this.status = status;
    Object.setPrototypeOf(this, NotificationsHttpError.prototype);
  }
}

export interface NotificationsTransport {
  /** A read. Returns the payload INSIDE the `{ data }` envelope. */
  get<T>(path: string): Promise<T>;
  /** A write. Returns a {@link NotificationsResult} rather than rejecting. */
  send<T>(path: string, method: string, body?: unknown): Promise<NotificationsResult<T>>;
}

const FALLBACK_ERROR = 'Não foi possível concluir a operação.';

export function httpNotificationsTransport(fallbackError = FALLBACK_ERROR): NotificationsTransport {
  return {
    async get<T>(path: string): Promise<T> {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: T; error?: string }
        | null;
      if (!response.ok) {
        throw new NotificationsHttpError(
          response.status,
          payload?.error ?? `HTTP ${response.status} for ${path}`,
        );
      }
      return (payload?.data ?? payload) as T;
    },

    async send<T>(path: string, method: string, body?: unknown): Promise<NotificationsResult<T>> {
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
        if (!response.ok) return { ok: false, error: payload?.error ?? fallbackError };
        return { ok: true, data: (payload?.data ?? payload) as T };
      } catch {
        return { ok: false, error: fallbackError };
      }
    },
  };
}
