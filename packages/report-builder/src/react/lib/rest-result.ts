/**
 * Tiny REST helper for the page ports' action adapters: same-origin JSON
 * fetch against the `{ data }` envelope, folded into the `Result` shape the
 * ported client components were written against.
 */

/** Mirror of `@12-apps/shared-helpers/forms` Result — the shape callers branch on. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

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

function foldError<T>(status: number, payload: ErrorEnvelope | null): Result<T> {
  const fieldErrors = fieldErrorsOf(payload);
  return {
    ok: false,
    error: payload?.error ?? `HTTP ${status}`,
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

export async function restResult<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Result<T>> {
  const hasBody = body !== undefined;
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as
      | ({ data?: T } & ErrorEnvelope)
      | null;
    if (!response.ok) return foldError(response.status, payload);
    return { ok: true, data: (payload?.data ?? null) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network error" };
  }
}
