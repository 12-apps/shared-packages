/**
 * The same-origin JSON call, folded into a RESULT rather than a throw.
 *
 * `./api`'s {@link apiFetch} throws {@link ApiError} on a non-2xx, which is
 * right for a read: a query hook wants the rejection, and an interceptor above
 * it keys on `status` and `body`. It is the wrong shape for a FORM. A form
 * submit has two ordinary outcomes — it saved, or the server refused it and
 * named the fields — and a refusal is not exceptional, so writing it as a throw
 * costs every submit handler a `try`/`catch` whose catch is the main path.
 *
 * So both exist, and the split is by CALLER rather than by preference:
 *
 *   - `apiFetch` — reads, and anything whose failure is somebody else's to
 *     handle (a query, a prefetch, a background refresh).
 *   - `restResult` — writes a human is waiting on, where "which field is wrong"
 *     is part of the answer.
 *
 * Both speak the `{ data }` / `{ error, issues }` envelope every `createApi*`
 * package answers in, so a surface can mix them without a second adapter. A
 * strict-input server answers a refused body with 422 and
 * `{ error, problems: [{ path, message }] }` instead; both shapes
 * fold into the same per-field messages.
 */
import { EN_US_REST_RESULT_FALLBACKS } from './en-US';

/**
 * What a write answers with: the value, or the refusal and what to paint.
 *
 * Structurally the `Result` of `@12-apps/shared-helpers/forms`, restated here
 * rather than imported so that a browser bundle carrying one form does not
 * resolve a server-shaped helpers package for a two-member union.
 */
export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** Per-input messages, keyed by the form's own field names. */
      fieldErrors?: Record<string, string>;
      /**
       * The HTTP status behind the failure, when there WAS a response at all —
       * absent for a network error, which is the difference between "the server
       * said no" and "nothing answered".
       *
       * Most callers only branch on `ok`. The ones that need more are the
       * concurrent surfaces: 403 is "not yours" and belongs beside the button,
       * while 409 is "somebody was faster" and is answered with a refresh.
       * Telling those apart is the whole reason an API answers with two codes,
       * and folding both into one sentence throws that away.
       */
      status?: number;
    };

/** The refusal half of the envelope, as a surface may answer it. */
interface ErrorEnvelope {
  error?: string;
  /** The older shape: one message per field name. */
  issues?: Record<string, string>;
  /** The strict-input shape: every problem with the path it was found at. */
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
  return Array.isArray(path) ? path.join('.') : ((path as string | undefined) ?? '');
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
    if (path !== '' && typeof problem.message === 'string') byPath[path] ??= problem.message;
  }
  return Object.keys(byPath).length > 0 ? byPath : payload?.issues;
}

/**
 * The sentences a refusal with no body, or no answer at all, falls back to.
 * English by default; a host passes its own (pt-BR:
 * `PT_BR_REST_RESULT_FALLBACKS` from `./pt-BR`).
 */
export interface RestResultFallbacks {
  /** No sentence in the body: name the status. */
  status: (status: number) => string;
  /** Nothing answered. */
  network: string;
}

function foldError<T>(
  status: number,
  payload: ErrorEnvelope | null,
  fallbacks: RestResultFallbacks,
): Result<T> {
  const fieldErrors = fieldErrorsOf(payload);
  return {
    ok: false,
    // A body that carried no sentence still has to say something, and the
    // status is the only fact there is. A caller that wants its own wording
    // branches on `status`; one that does not gets a line naming the code
    // rather than an empty string.
    error: payload?.error ?? fallbacks.status(status),
    status,
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

/**
 * Call `path` and fold the answer.
 *
 * Never throws — a network failure is `{ ok: false }` with no `status`, for the
 * reason above. `body` is JSON-serialized when present, and its presence is
 * what adds the `Content-Type`, so a bodyless `DELETE` does not advertise one.
 */
export async function restResult<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  fallbacks: RestResultFallbacks = EN_US_REST_RESULT_FALLBACKS,
): Promise<Result<T>> {
  const hasBody = body !== undefined;
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as
      | ({ data?: T } & ErrorEnvelope)
      | null;
    if (!response.ok) return foldError(response.status, payload, fallbacks);
    return { ok: true, data: (payload?.data ?? null) as T };
  } catch {
    // Whatever was thrown, the reader is told nothing answered, in the host's
    // words. fetch rejects with a TypeError whose message is the browser's own
    // English ("Failed to fetch"), never a sentence for this screen.
    return { ok: false, error: fallbacks.network };
  }
}
