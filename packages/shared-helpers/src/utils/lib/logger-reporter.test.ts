import { describe, expect, it, vi } from 'vitest';

/**
 * Unit (FUT-716): the logger→reporter wiring itself.
 *
 * Separate from `sentry.test.ts` because it has to MOCK the SDK at the module
 * boundary, which is file-wide in vitest. What it proves is the part that
 * cannot be read from the source with confidence: that the transport is
 * actually attached to the shared logger when a DSN exists, that a feature
 * logger's `error` reaches it, and that ordinary chatter does not — an error
 * reporter which quietly forwards `info` is a bill and a haystack.
 */
const seen = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@sentry/node', () => ({
  init: () => undefined,
  getClient: () => ({}),
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setTag: () => undefined, setLevel: () => undefined }),
  captureException: (error: unknown) => seen.calls.push(`exception:${(error as Error).message}`),
  captureMessage: (message: unknown) => seen.calls.push(`message:${String(message)}`),
}));

describe('the shared logger reports errors when a DSN is configured', () => {
  it('attaches the transport, forwards error + warn, and drops info', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://abc@o0.ingest.sentry.io/1');
    const { logger, createFeatureLogger } = await import('./logger');

    // The transport is on the SHARED logger, so every feature is covered by
    // existing — nothing to remember when a new module starts logging.
    expect(logger.transports.map((transport) => transport.constructor.name)).toContain(
      'SentryTransport',
    );

    const log = createFeatureLogger('payments');
    // The exact line a failing checkout leaves behind, and the one that was
    // unreadable in production for a week.
    log.error('[payments] order creation failed: no hosted-checkout URL');
    log.warn('payments.void unsupported');
    log.info('routine chatter must NOT be reported');

    // Winston hands a transport its `info` asynchronously, so poll for the
    // arrival rather than sleeping a guessed number of milliseconds — a fixed
    // delay is either slower than it needs to be or flaky on a loaded runner.
    await vi.waitFor(() => {
      expect(seen.calls.some((call) => call.includes('order creation failed'))).toBe(true);
    });
    expect(seen.calls.some((call) => call.includes('payments.void unsupported'))).toBe(true);
    expect(seen.calls.some((call) => call.includes('routine chatter'))).toBe(false);
  });
});
