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
}

function foldError<T>(status: number, payload: ErrorEnvelope | null): Result<T> {
  return {
    ok: false,
    error: payload?.error ?? `HTTP ${status}`,
    ...(payload?.issues ? { fieldErrors: payload.issues } : {}),
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
