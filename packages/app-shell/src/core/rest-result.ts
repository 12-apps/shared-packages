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
 * package answers in, so a surface can mix them without a second adapter.
 */

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
  issues?: Record<string, string>;
}

function foldError<T>(status: number, payload: ErrorEnvelope | null): Result<T> {
  return {
    ok: false,
    // A body that carried no sentence still has to say something, and the
    // status is the only fact there is. A caller that wants its own wording
    // branches on `status`; one that does not gets a line naming the code
    // rather than an empty string.
    error: payload?.error ?? `HTTP ${status}`,
    status,
    ...(payload?.issues ? { fieldErrors: payload.issues } : {}),
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
    if (!response.ok) return foldError(response.status, payload);
    return { ok: true, data: (payload?.data ?? null) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'network error' };
  }
}
