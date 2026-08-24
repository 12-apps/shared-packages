/**
 * `@12-apps/observability-backend` over a REAL socket, into this harness's own
 * envelope ingest.
 *
 * The frontend harness already drives the browser half this way — a served DSN,
 * a real `@sentry/react` init, and the events landing on `observability-host.ts`
 * — and the SERVER half had no consumer anywhere. That absence is the sharp one
 * of the two: this package's entire purpose is reaching a place a log line
 * cannot, and "does an event actually leave the process" is a question its own
 * suite structurally cannot ask. A unit test can call `scrub` and assert the
 * redaction; only a consumer can watch the redacted payload arrive.
 *
 * ## Why a real server
 *
 * The Sentry SDK POSTs to the DSN's host, so a DSN pointing at an in-process
 * Hono app reaches nothing. `@hono/node-server` puts this harness's own app on
 * an ephemeral port and the DSN points there, which makes the whole path real:
 * the transport, `initSentry`, the batching, `beforeSend`, the envelope format,
 * the HTTP request, and this host's ingest at the other end.
 *
 * ## Why the process env is set here
 *
 * `sentryEnabled()` reads `SENTRY_DSN` and `initSentry` reads three more, at
 * CALL time — which is the package's own doctrine (a host configures the
 * environment; the package never takes a config object). A suite that mocked
 * those reads would be testing a different function.
 */
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import winston from 'winston';

import { flushReporter, scrub, sentryEnabled, sentryTransport } from '@12-apps/observability-backend';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { capturedEvents, observability } from '../src/observability-host';

let backend: HarnessBackend;
let server: ReturnType<typeof serve>;
/** The port the ingest is actually listening on — never a guessed one. */
const listening = { port: 0 };

beforeAll(async () => {
  backend = await createHarnessBackend();
  server = serve({ fetch: backend.app.fetch, port: 0 });
  await new Promise<void>((resolve) => {
    server.once('listening', () => {
      listening.port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
  // The DSN a deployment would hold, pointed at this host: the SDK POSTs to
  // `<host>/api/<projectId>/envelope/`, which is the route the ingest serves.
  //
  // The public key is alphanumeric ON PURPOSE. A DSN whose key carries a hyphen
  // is accepted by `Sentry.init` — `getClient()` answers, `flush()` resolves
  // true — and every event is discarded before it is sent. Nothing throws and
  // nothing logs, which is a full afternoon if the harness spells one that way
  // and reads the silence as "the transport does not work".
  // `vi.stubEnv` rather than a bare assignment: the values are restored for
  // every other suite in the run, which is the property the flakiness gate is
  // protecting — a DSN left behind would make some other file's logger start
  // shipping events to a socket that has closed.
  vi.stubEnv('SENTRY_DSN', `http://harnesskey@127.0.0.1:${listening.port}/42`);
  vi.stubEnv('SENTRY_ENVIRONMENT', 'harness');
  vi.stubEnv('SENTRY_RELEASE', 'harness-1.0.0');
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await backend.close();
});

/** A logger shaped like a host's: colorized level, a `feature` on the meta. */
function loggerWithTransport(): winston.Logger {
  const transport = sentryTransport();
  if (!transport) throw new Error('a DSN is set, so the transport must exist');
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    transports: [transport],
  });
}

/**
 * Every event this ingest has seen — waited for, not merely flushed.
 *
 * `flushReporter` resolves when the SDK's queue is empty, which is one hop
 * short of what a consumer actually wants to know: the POST has to arrive and
 * be parsed at the other end. Asserting on the flush alone passes on a quick
 * machine and fails on a slow one — so the wait is on the ARRIVAL, through
 * `vi.waitFor`, which retries the assertion rather than sleeping for a guess.
 */
async function deliveredEvents(atLeast = 1): Promise<Record<string, unknown>[]> {
  await flushReporter(4000);
  await vi.waitFor(() => {
    expect(capturedEvents().length).toBeGreaterThanOrEqual(atLeast);
  });
  return capturedEvents();
}

describe('the reporter a host installs', () => {
  it('is OFF without a DSN, and says so rather than pretending', () => {
    const dsn = String(process.env['SENTRY_DSN']);
    vi.stubEnv('SENTRY_DSN', '');

    // The property every call site depends on: a host never has to ask whether
    // reporting is configured, because the package answers `null` and a no-op
    // instead of throwing or half-initialising.
    expect(sentryEnabled()).toBe(false);
    expect(sentryTransport()).toBeNull();

    vi.stubEnv('SENTRY_DSN', dsn);
  });

  it('carries an error to the ingest, tagged with the feature that raised it', async () => {
    observability.reset();
    loggerWithTransport().error('a lamp failed to relight', {
      feature: 'lamps',
      cause: new Error('the wick is wet'),
    });

    const events = await deliveredEvents();

    expect(events.length).toBeGreaterThan(0);
    const event = events.at(-1) as { tags?: Record<string, string>; environment?: string };
    expect(event.tags?.['feature']).toBe('lamps');
    // The environment and release a deployment sets, on the event: without them
    // a browser event and the 500 behind it land in different buckets, which is
    // the reason the two packages share those two variables at all.
    expect(event.environment).toBe('harness');
  });

  it('reports a WARN as a warning rather than dropping it', async () => {
    observability.reset();
    loggerWithTransport().warn('the supply run is late', { feature: 'supply' });

    const events = await deliveredEvents();

    expect(events.length).toBeGreaterThan(0);
    expect((events.at(-1) as { level?: string }).level).toBe('warning');
  });

  it('leaves INFO alone — the transport is level-gated at warn', async () => {
    observability.reset();
    const logger = loggerWithTransport();
    logger.info('the lamp was lit on time', { feature: 'lamps' });
    // A MARKER rather than a pause: an error logged after the info line, waited
    // for by arrival. When it lands, everything queued before it has had its
    // chance — so "exactly one event arrived" is a claim about the info line
    // rather than about how fast this machine is.
    logger.error('the lamp went out', { feature: 'lamps', cause: new Error('wind') });

    const events = await deliveredEvents();

    // A reporter that filed every info line would cost money per event and bury
    // the ones worth reading.
    expect(events).toHaveLength(1);
    expect((events[0] as { level?: string }).level).toBe('error');
  });

  it('does not carry the winston META object to the ingest at all', async () => {
    observability.reset();
    // Built at runtime, and that is not fussiness: the SDK attaches SOURCE
    // CONTEXT to every frame (see the next case), so a CPF written as a literal
    // on a line near the throw would arrive inside the stack rather than inside
    // the meta — and this case would pass or fail for the wrong reason.
    const cpf = ['123', '456', '789', '01'].join('');
    const address = ['ana', 'harness.dev'].join('@');

    loggerWithTransport().error('checkout refused', {
      feature: 'checkout',
      cause: new Error('provider said no'),
      // The shape the package's own docblock names as the reason `beforeSend`
      // exists: a provider's error body, buyer CPF and all.
      extra: { cpf, email: address, orderId: 'ord-7' },
    });

    const body = JSON.stringify(await deliveredEvents());

    // The package's FIRST line of defence, and the one a host most needs to be
    // true: the transport sends the message string and the Error, never the raw
    // meta — so a payload a host logged beside its message does not become a
    // third party's copy of it. `scrub` and `beforeSend` are the second and
    // third lines, for what a host puts on the event itself.
    expect(body).not.toContain(cpf);
    expect(body).not.toContain(address);
  });

  it('ships the SOURCE around each frame — a caveat a host must know', async () => {
    observability.reset();
    loggerWithTransport().error('a lamp failed', { feature: 'lamps', cause: new Error('wet') });

    const delivered = await deliveredEvents();
    const frames = (
      delivered[0] as {
        exception?: { values?: { stacktrace?: { frames?: Record<string, unknown>[] } }[] };
      }
    ).exception?.values?.[0]?.stacktrace?.frames;

    // Every frame carries `context_line` plus the lines around it. That is what
    // makes a report readable without checking out the commit — and it is also
    // the one exposure `scrub` cannot cover, because it redacts by KEY on the
    // event and a secret written as a literal in source is neither. A host that
    // hardcodes a credential near a throwing line ships it with the report.
    expect(frames?.length).toBeGreaterThan(0);
    expect(frames?.some((frame) => typeof frame['context_line'] === 'string')).toBe(true);
  });

  it('scrubs the same way a caller can check before sending', () => {
    // The exported half of the same rule, for a host that wants to log
    // something itself. Asserted here because a consumer is where the two can
    // be compared: the redaction the wire showed above IS this function.
    expect(scrub({ nested: { cpf: '12345678901', keep: 'yes' } })).toEqual({
      nested: { cpf: '[redacted]', keep: 'yes' },
    });
  });
});
