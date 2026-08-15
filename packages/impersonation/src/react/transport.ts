/**
 * How this surface reaches its endpoints.
 *
 * A seam rather than a bare `fetch` so a host behind a proxy, an auth header or
 * a test double substitutes one function instead of monkey-patching the global.
 * The default is a same-origin credentialed fetch, which is what the cookie this
 * whole package is about requires anyway.
 */

/** A refusal the server explained. */
export class ImpersonationHttpError extends Error {
  readonly status: number;
  /** The parsed body, when there was one — the server's own sentence lives here. */
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`impersonation: ${status}`);
    this.name = 'ImpersonationHttpError';
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, ImpersonationHttpError.prototype);
  }
}

export interface ImpersonationTransport {
  /** Throws {@link ImpersonationHttpError} on anything that is not a 2xx. */
  request(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown>;
}

async function parse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A 204, an empty body, or an HTML error page from a proxy. The status is
    // what the caller branches on; the body is a courtesy.
    return null;
  }
}

export function httpImpersonationTransport(): ImpersonationTransport {
  return {
    async request(path, init) {
      const response = await fetch(path, {
        method: init?.method ?? 'GET',
        credentials: 'same-origin',
        headers:
          init?.body === undefined
            ? { Accept: 'application/json' }
            : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const body = await parse(response);
      if (!response.ok) throw new ImpersonationHttpError(response.status, body);
      return body;
    },
  };
}
