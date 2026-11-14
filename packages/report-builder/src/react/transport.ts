import { EN_US_REPORT_TRANSPORT_ERROR_COPY } from "./en-US.transport";
import type { Result } from "./lib/rest-result";
import type { ReportTransportErrorCopy } from "./screens-copy";

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

/** What {@link httpTransport} is built with. */
export interface HttpTransportOptions {
  /**
   * What a failed call reads as when the server sent no sentence (FUT-4070).
   * `createWebReportBuilder` passes the mounted copy's `screens.errors`; a host
   * building the transport by hand passes its own pack's. English when absent,
   * as `@12-apps/app-shell`'s `restResult` is.
   */
  errors?: ReportTransportErrorCopy;
}

/**
 * A read that rejects in the host's words: the status when the server refused,
 * `errors.network` when nothing answered. Never the browser's own message, nor
 * the path, which is not a sentence for a screen.
 */
async function readJson<T>(path: string, errors: ReportTransportErrorCopy): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error(errors.network);
  }
  if (!response.ok) throw new Error(errors.status(response.status));
  return (await response.json()) as T;
}

/**
 * The transport a host gets when it names no other: same-origin `fetch`,
 * riding the browser's cookies. This is the pre-FUT-391 behaviour exactly, so
 * an existing consumer that mounts the pages sees no change.
 */
export function httpTransport(options: HttpTransportOptions = {}): ReportBuilderTransport {
  const errors = options.errors ?? EN_US_REPORT_TRANSPORT_ERROR_COPY;
  return {
    async get<T>(path: string): Promise<T> {
      const payload = await readJson<{ data: T }>(path, errors);
      return payload.data;
    },
    getRaw: <T,>(path: string) => readJson<T>(path, errors),
    send: async <T,>(path: string, method: string, body?: unknown): Promise<Result<T>> => {
      const { restResult } = await import("./lib/rest-result");
      return restResult<T>(path, method, body, errors);
    },
  };
}
