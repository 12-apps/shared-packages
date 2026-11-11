/**
 * How the discounts screens reach their data — the report-builder transport
 * doctrine, which `@12-apps/entity-lifecycle` also follows: this is the ONLY
 * way the surface performs I/O, so a caller supplying one has substituted the
 * entire backend without stubbing a global. That is what makes the screens
 * drivable from a story and testable without a server.
 *
 * The default is a same-origin `fetch` riding the browser's cookies.
 */

/** A write outcome the screens BRANCH on, rather than a thrown mutation. */
export type DiscountsResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** Per-input messages the form paints, keyed by its own field names. */
      fieldErrors?: Record<string, string>;
      /** The status behind the failure; absent when nothing answered at all. */
      status?: number;
    };

/** A failed read, carrying the status a screen may want to branch on. */
export class DiscountsHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DiscountsHttpError";
    this.status = status;
    Object.setPrototypeOf(this, DiscountsHttpError.prototype);
  }
}

export interface DiscountsTransport {
  /** A read. Answers the whole JSON payload, envelope included. */
  get<T>(path: string): Promise<T>;
  /** A write. Answers a {@link DiscountsResult} rather than rejecting. */
  send<T>(path: string, method: string, body?: unknown): Promise<DiscountsResult<T>>;
}

/** The refusal half of the envelope every `createApi*` package answers in. */
interface ErrorEnvelope {
  error?: string;
  issues?: Record<string, string>;
  /** The strict-input shape (422): every problem with the path it was found at. */
  problems?: readonly ProblemWire[];
}

/** One problem as the wire carries it: a path (dotted, or its segments) and a sentence. */
interface ProblemWire {
  path?: string | ReadonlyArray<string | number>;
  message?: string;
}

/** The dotted path of one problem; segments are joined, a missing path is the whole body. */
function pathOf(problem: ProblemWire): string {
  const { path } = problem;
  return Array.isArray(path) ? path.join(".") : ((path as string | undefined) ?? "");
}

/**
 * Per-field messages out of a refusal body: `problems` (path-keyed, dotted for
 * nesting) when the server sent them, else the older `issues` record.
 *
 * Several problems at one path keep the FIRST message, which is the one a form
 * can paint beside a single input. A problem with no path (the body as a whole)
 * has no input to sit beside, so it is left to `error`.
 */
function fieldErrorsOf(payload: ErrorEnvelope | null): Record<string, string> | undefined {
  const problems = Array.isArray(payload?.problems) ? payload.problems : [];
  const byPath: Record<string, string> = {};
  for (const problem of problems) {
    const path = pathOf(problem);
    if (path !== "" && typeof problem.message === "string") byPath[path] ??= problem.message;
  }
  return Object.keys(byPath).length > 0 ? byPath : payload?.issues;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ErrorEnvelope | null;
    throw new DiscountsHttpError(
      response.status,
      payload?.error ?? `HTTP ${response.status} for ${path}`,
    );
  }
  return (await response.json()) as T;
}

/** The headers and body a write carries — the `Content-Type` only when there is one. */
function requestInit(method: string, body: unknown): RequestInit {
  const hasBody = body !== undefined;
  return {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  };
}

/** A non-2xx, folded into the shape a form branches on. */
function refusal<T>(
  status: number,
  payload: ErrorEnvelope | null,
  fallbackError: string,
): DiscountsResult<T> {
  const fieldErrors = fieldErrorsOf(payload);
  return {
    ok: false,
    error: payload?.error ?? fallbackError,
    status,
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

/**
 * @param fallbackError What a failed write says when the server sent no
 * sentence of its own — REQUIRED, the host's words. `createWebDiscounts`
 * passes its (equally required) `copy.form.saveFailed`; only a host building
 * the transport by hand writes it here.
 */
export function httpDiscountsTransport(fallbackError: string): DiscountsTransport {
  return {
    get: readJson,
    async send<T>(path: string, method: string, body?: unknown): Promise<DiscountsResult<T>> {
      try {
        const response = await fetch(path, requestInit(method, body));
        const payload = (await response.json().catch(() => null)) as
          | ({ data?: T } & ErrorEnvelope)
          | null;
        if (!response.ok) return refusal<T>(response.status, payload, fallbackError);
        return { ok: true, data: (payload?.data ?? null) as T };
      } catch (error) {
        // No `status`, deliberately: its absence is the only thing separating
        // "the server said no" from "nothing answered", and the two want
        // different handling.
        return { ok: false, error: error instanceof Error ? error.message : fallbackError };
      }
    },
  };
}
