import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit (FUT-3968): a log call that carries a real `Error` reaches Sentry as an
 * EXCEPTION, with its stack, so uploaded source maps have frames to work on.
 *
 * Winston hands the transport `log.error(msg, error)` with the error folded
 * into the message and the object itself only under `Symbol.for('splat')`; the
 * transport used to read `Object.values(info)` alone and sent every such call
 * as a bare message.
 */

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setExtra: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  getClient: vi.fn(() => undefined),
  flush: vi.fn(async () => true),
  captureException: sentry.captureException,
  captureMessage: sentry.captureMessage,
  withScope: (callback: (scope: unknown) => void) =>
    callback({ setTag: vi.fn(), setLevel: vi.fn(), setExtra: sentry.setExtra }),
}));

const SPLAT = Symbol.for('splat');

/** Hand the transport one Winston `info` and wait for it to finish. */
async function deliver(info: Record<string | symbol, unknown>): Promise<void> {
  const { sentryTransport } = await import('../index');
  const transport = sentryTransport();
  if (!transport) throw new Error('the transport should exist with a DSN set');
  await new Promise<void>((done) => transport.log?.(info, done));
}

beforeEach(() => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  sentry.setExtra.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('an Error carried by a log call reaches Sentry as an exception', () => {
  it('finds the error Winston keeps only under the splat symbol', async () => {
    const error = new Error('Transaction API error: boom');

    await deliver({
      level: 'error',
      message: '[api] route handler threw an unexpected error: Transaction API error: boom',
      stack: error.stack,
      [SPLAT]: [error],
    });

    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.setExtra).toHaveBeenCalledWith(
      'log',
      '[api] route handler threw an unexpected error: Transaction API error: boom',
    );
  });

  it('still finds an error passed as a named meta field', async () => {
    const error = new Error('kaput');

    await deliver({ level: 'error', message: 'job failed', cause: error });

    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('sends a plain message when the call carried no error', async () => {
    await deliver({ level: 'warn', message: 'slow token', [SPLAT]: ['2974 ms'] });

    expect(sentry.captureMessage).toHaveBeenCalledWith('slow token');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('forwards nothing below warn', async () => {
    await deliver({ level: 'info', message: 'booted', [SPLAT]: [new Error('not an incident')] });

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
