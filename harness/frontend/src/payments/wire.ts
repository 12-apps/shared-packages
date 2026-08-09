/**
 * THE WIRE a harness page hangs between a published client and its in-page
 * mount (FUT-743) — extracted from `./store.ts` so the merchant admin store
 * (`./admin-store.ts`) can share it instead of copying it: a second copy of
 * this function is ~20 near-identical lines inside `harness/**`, squarely in
 * `quality:dup`'s scope.
 *
 * One implementation on purpose. The buyer checkout table and the merchant
 * settings table differ in their verbs and their prefix, and in nothing else
 * this file does — and the recording is the whole point: it is the only place
 * the BYTES are visible, and every FUT-740 critical was a byte-level
 * disagreement both sides' own tests were structurally unable to see.
 */

/** One request the published client actually put on the wire. */
export interface WireRequest {
  method: string;
  /** The path as the client wrote it, prefix included — `/api/checkout/charge`. */
  path: string;
  /** The parsed JSON body, or null for a GET. */
  body: Record<string, unknown> | null;
  /** Filled in when the response resolves; absent while in flight. */
  status?: number;
}

/** A minimal listener set — a probe re-renders off this, not off a timer. */
export function notifier(): {
  fire: () => void;
  subscribe: (listener: () => void) => () => void;
} {
  const listeners = new Set<() => void>();
  return {
    fire: () => listeners.forEach((listener) => listener()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The request body as an object, or null — never a throw on a GET. */
export function parseBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** What {@link recordingTransport} needs beside the routes. */
export interface RecordingTransportOptions {
  /** The client's own prefix — stripped before the mount's table matches. */
  baseUrl: string;
  /** Every crossing request lands here, in initiation order. */
  requests: WireRequest[];
  /** Wakes the probe: at initiation, and again when the status lands. */
  fire: () => void;
}

/**
 * The `fetch` a published client is handed: record what crossed, then route it
 * straight into the mount. ONE implementation for both mounts.
 *
 * Two facts callers depend on:
 *   - The URL handed to the mount is ABSOLUTE, because the admin table's
 *     `requestedEnvironment` does `new URL(request.url).searchParams`.
 *   - Entries are pushed at INITIATION time and stamped with `status` when the
 *     response resolves, so the array's order is request order but a status
 *     may still be absent when a spec first looks. Wire assertions must
 *     auto-retry.
 */
export function recordingTransport<M extends string>(
  routes: Record<
    M,
    (request: Request, context: { params: { segments: string[] } }) => Promise<Response>
  >,
  opts: RecordingTransportOptions,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    // Named anything but `path`: a local called `path` reads as `node:path` to
    // the flakiness gate's unmocked-fs rule.
    const target = String(input);
    const entry: WireRequest = {
      method: init?.method ?? 'GET',
      path: target.split('?')[0] ?? target,
      body: parseBody(init?.body),
    };
    opts.requests.push(entry);
    opts.fire(); // in-flight is visible
    // A path that does not start with baseUrl is routed with EMPTY segments, so
    // it 404s loudly instead of being silently repaired.
    const rest = target.startsWith(opts.baseUrl) ? target.slice(opts.baseUrl.length) : '';
    const [route = '', query] = rest.split('?');
    const url = `https://loja.exemplo${opts.baseUrl}${route}${query ? `?${query}` : ''}`;
    const verb = (init?.method ?? 'GET') as M;
    const response = await routes[verb](new Request(url, init as RequestInit), {
      params: { segments: route.split('/').filter(Boolean) },
    });
    entry.status = response.status; // same object; log order stays request order
    opts.fire();
    return response;
  };
}
