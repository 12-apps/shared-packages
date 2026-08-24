/**
 * The two halves of `@12-apps/observability-frontend` that only a HOST has: the
 * endpoint that serves the DSN, and somewhere for the events to land.
 *
 * ## Why the DSN is served rather than baked
 *
 * The package's own argument: a Vite bundle inlines `import.meta.env` at build
 * time, so a baked DSN cannot be rotated without a rebuild, and a static bundle
 * has no process of its own to read env on its behalf. So the browser ASKS —
 * `GET /api/observability-config?app=…` — and the answer is this host's.
 *
 * That makes the whole feature's default state a host decision: **no DSN, no
 * SDK, no network**. Dev, CI and every test run stay offline, which is also
 * what stops a suite filling an issue tracker with its own deliberate failures.
 * `observabilityConfig.dsn = ''` is that state, and it is what this harness
 * boots in — so every other page in this app is unaffected by the one page that
 * turns reporting on.
 *
 * ## The ingest, and why a real one
 *
 * Asserting that reporting "works" by checking a flag proves nothing: the whole
 * point of `beforeSend` is that some events must NOT leave, and an event that
 * was dropped and an event that was never produced look identical from inside
 * the page. So this host stands up the thing a DSN actually points at — the
 * envelope endpoint — and records what arrives.
 *
 * A Sentry DSN is a URL (`http://<key>@<host>/<projectId>`), and the SDK POSTs
 * to `<host>/api/<projectId>/envelope/`. Point the host at the harness's own
 * origin and the SDK's real transport, its real serialisation and its real
 * `beforeSend` pipeline all run — over Vite's proxy into this server. Nothing
 * about the package is stubbed; only the far end of the wire is ours.
 */
import { Hono } from 'hono';

/** One envelope as it arrived, already split into its newline-delimited parts. */
export interface CapturedEnvelope {
  /** The envelope header — carries the SDK and the DSN it was sent with. */
  header: Record<string, unknown>;
  /** Every item after the header, header and payload alike. */
  items: Record<string, unknown>[];
}

/**
 * The served config, and the events that came back.
 *
 * One mutable container rather than module-level bindings, for the reason the
 * rest of this harness uses one: the flakiness gate refuses a closed-over
 * binding reassigned from a stub.
 */
export const observability = {
  /** Empty is the DEFAULT and the important one: reporting is off. */
  dsn: '',
  environment: 'harness',
  release: '',
  captured: [] as CapturedEnvelope[],
  reset(): void {
    observability.dsn = '';
    observability.environment = 'harness';
    observability.release = '';
    observability.captured = [];
  },
};

/** Every event body that reached the ingest, whatever kind of item carried it. */
export function capturedEvents(): Record<string, unknown>[] {
  return observability.captured.flatMap((envelope) =>
    // Items alternate header, payload. An event payload is the one carrying a
    // level, an exception or a message — which is exactly what a suite asks
    // about, and what a header never has.
    envelope.items.filter(
      (item) => 'exception' in item || 'message' in item || 'level' in item,
    ),
  );
}

/**
 * Parse Sentry's envelope format: newline-delimited JSON, one header then
 * alternating item-header/item-payload lines.
 *
 * Parsed rather than stored raw because the assertions are about FIELDS — a
 * scrubbed URL, a tag, a dropped event — and a suite matching substrings in a
 * blob would pass on a payload that merely mentioned the right word somewhere.
 */
function parseEnvelope(body: string): CapturedEnvelope | null {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  const [first, ...rest] = lines;
  if (first === undefined) return null;
  try {
    return {
      header: JSON.parse(first) as Record<string, unknown>,
      items: rest.map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  } catch {
    // A body this host cannot read is a fact worth keeping rather than
    // swallowing: a suite asserting "nothing was sent" must not be satisfied
    // by a send that merely failed to parse.
    return { header: { unparsed: body }, items: [] };
  }
}

export function observabilityRoutes(): Hono {
  const app = new Hono();

  // The package's own `DEFAULT_CONFIG_ENDPOINT`. `?app=` is the host's to
  // interpret — a real one serves a different project per SPA; this one has a
  // single app and answers the same config for any name, which is still a
  // deliberate answer rather than a missing one.
  app.get('/api/observability-config', (c) =>
    c.json({
      data: {
        dsn: observability.dsn,
        environment: observability.environment,
        release: observability.release,
      },
    }),
  );

  // Where a DSN pointed at this origin actually delivers. Both spellings: the
  // SDK sends the trailing slash, and Hono treats the two as different paths.
  const ingest = async (c: Parameters<Parameters<Hono['post']>[1]>[0]) => {
    const parsed = parseEnvelope(await c.req.text());
    if (parsed !== null) observability.captured.push(parsed);
    // 200 with an id, as the real ingest answers — a 4xx would make the SDK
    // retry and turn one deliberate error into several arrivals.
    return c.json({ id: String(observability.captured.length) });
  };
  app.post('/api/:projectId/envelope', ingest);
  app.post('/api/:projectId/envelope/', ingest);

  return app;
}

/** The suite's controls: what to serve, and what has arrived. */
export function observabilityHarnessRoutes(): Hono {
  const app = new Hono();

  app.post('/config', async (c) => {
    const body = (await c.req.json()) as Partial<
      Pick<typeof observability, 'dsn' | 'environment' | 'release'>
    >;
    if (body.dsn !== undefined) observability.dsn = body.dsn;
    if (body.environment !== undefined) observability.environment = body.environment;
    if (body.release !== undefined) observability.release = body.release;
    return c.body(null, 204);
  });

  app.get('/events', (c) =>
    c.json({ data: capturedEvents(), envelopes: observability.captured.length }),
  );

  app.post('/clear', (c) => {
    observability.captured = [];
    return c.body(null, 204);
  });

  return app;
}
