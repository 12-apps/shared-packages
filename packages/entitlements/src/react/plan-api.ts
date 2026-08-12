/**
 * The surface's own transport: three requests, no client library.
 *
 * Deliberately plain `fetch` + React state rather than a query cache — the
 * package must not force a data library onto its hosts, and the plan screen
 * is one read + one idempotent write.
 */
import { useCallback, useEffect, useState } from 'react';

import type { FiledPlanRequest, OpenPlanRequest, TenantPlanPayload } from '../plan-wire';

interface PlanApi {
  getPlan(): Promise<{ plan: TenantPlanPayload }>;
  getOpenRequest(): Promise<{ request: OpenPlanRequest | null }>;
  requestPlanChange(body: {
    requestedPlan: string;
    feature?: string;
  }): Promise<{ request: FiledPlanRequest; created: boolean }>;
}

/**
 * Every SUCCESS body arrives as the `{ data: … }` envelope (the same
 * invariant future-pay documents for its whole `/api/admin/**` surface) and
 * is unwrapped here; error bodies are never enveloped, so the failure path
 * reads `error` off the bare body.
 */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      body !== null && typeof body.error === 'string'
        ? body.error
        : `Falha na requisição (${response.status}).`;
    throw new Error(message);
  }
  const envelope = (await response.json()) as { data: T };
  return envelope.data;
}

export function createPlanApi(apiBase: string, fetchImpl: typeof fetch): PlanApi {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> =>
    readJson<T>(await fetchImpl(`${apiBase}${path}`, init));
  return {
    getPlan: () => request('/plan'),
    getOpenRequest: () => request('/plan/request'),
    requestPlanChange: (body) =>
      request('/plan/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

/** A read as the screen consumes it. */
interface AsyncRead<T> {
  data: T | null;
  error: Error | null;
  pending: boolean;
  reload: () => void;
}

/** One fetch, started on mount, reloadable — the whole lifecycle the page needs. */
export function useRead<T>(read: () => Promise<T>): AsyncRead<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; pending: boolean }>({
    data: null,
    error: null,
    pending: true,
  });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((previous) => ({ ...previous, pending: true }));
    read().then(
      (data) => {
        if (alive) setState({ data, error: null, pending: false });
      },
      (error: unknown) => {
        if (alive) {
          setState({
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            pending: false,
          });
        }
      },
    );
    return () => {
      alive = false;
    };
    // `read` is deliberately NOT a dependency: it is stable by construction
    // (bound to the factory's config), and the epoch is the reload signal.
  }, [epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return { ...state, reload };
}
