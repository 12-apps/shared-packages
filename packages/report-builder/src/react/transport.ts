import type { Result } from "./lib/rest-result";

/**
 * How the reports surface reaches its data (FUT-391).
 *
 * Every screen in this package went through `fetch` at module scope, which
 * made the whole surface unmountable anywhere without a live host: no consumer
 * harness, no Storybook, no test that renders a screen rather than a rule. It
 * also meant a host could not put the reports UI behind its own client — an
 * auth-refreshing wrapper, a different base path, a request logger.
 *
 * The transport is that seam, and nothing more: it is the ONLY way this
 * package performs I/O, so a caller supplying one has substituted the entire
 * backend without stubbing a global.
 */
export interface ReportBuilderTransport {
  /**
   * A read. Returns the payload the endpoint's `{ data }` envelope carries —
   * unwrapping is the transport's job, so screens never see the envelope.
   * Rejects on a transport or HTTP error; react-query turns that into an
   * error state.
   */
  get<T>(path: string): Promise<T>;
  /**
   * A read that does NOT unwrap. Needed because not every endpoint this
   * surface calls answers with the reports `{ data }` envelope — the roles
   * picker returns `{ data, pagination }` and needs both halves, so unwrapping
   * would silently discard the paging cursor and stop the loop after one page.
   */
  getRaw<T>(path: string): Promise<T>;
  /**
   * A write. Returns a {@link Result} rather than rejecting, because every
   * caller of this branches on `ok` to show a field error — a thrown mutation
   * would be caught only to be re-folded into the same shape.
   */
  send<T>(path: string, method: string, body?: unknown): Promise<Result<T>>;
}

/**
 * The transport a host gets when it names no other: same-origin `fetch`,
 * riding the browser's cookies. This is the pre-FUT-391 behaviour exactly, so
 * an existing consumer that mounts the pages sees no change.
 */
async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return (await response.json()) as T;
}

export function httpTransport(): ReportBuilderTransport {
  return {
    async get<T>(path: string): Promise<T> {
      const payload = await readJson<{ data: T }>(path);
      return payload.data;
    },
    getRaw: <T,>(path: string) => readJson<T>(path),
    send: async <T,>(path: string, method: string, body?: unknown): Promise<Result<T>> => {
      const { restResult } = await import("./lib/rest-result");
      return restResult<T>(path, method, body);
    },
  };
}
