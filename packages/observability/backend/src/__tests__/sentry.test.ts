import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushReporter, scrub, sentryEnabled, sentryTransport } from '../index';

/**
 * Unit (FUT-716): what the error reporter is allowed to send, and when it
 * exists at all.
 *
 * Both halves are safety properties rather than features. Reporting that
 * cannot be switched off would have a test suite's deliberate failures filling
 * an issue tracker and a dev machine talking to a third party; reporting that
 * forwards whatever it was handed would ship the buyer's name, e-mail and tax
 * id along with the error that mentioned them — which is a real payload in this
 * codebase, not a hypothetical one (`ProviderRequestError` retains the
 * provider's parsed response body).
 */

// `vi.unstubAllEnvs` rather than deleting the key by hand: mutating
// `process.env` directly leaks into whatever runs next in the same worker,
// which is exactly the flakiness the gate refuses.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('reporting is OFF unless a DSN is configured', () => {
  it('is disabled, and installs no transport, with no DSN', () => {
    expect(sentryEnabled()).toBe(false);
    expect(sentryTransport()).toBeNull();
  });

  it('an empty DSN counts as absent — not as "configured with nothing"', () => {
    vi.stubEnv('SENTRY_DSN', '');

    expect(sentryEnabled()).toBe(false);
    expect(sentryTransport()).toBeNull();
  });
});

describe('scrub — what may never leave the process', () => {
  it('redacts the buyer fields a provider payload carries', () => {
    // The exact shape a PagBank rejection comes back as.
    const event = {
      message: 'order creation failed',
      customer: { name: 'Ana Souza', email: 'ana@example.com', taxId: '529.982.247-25' },
    };

    expect(scrub(event)).toEqual({
      message: 'order creation failed',
      customer: '[redacted]',
    });
  });

  it('reaches PII nested inside an arbitrary structure', () => {
    const event = { extra: { response: { body: { buyerEmail: 'ana@example.com', id: 'ord_1' } } } };

    expect(scrub(event)).toEqual({
      extra: { response: { body: { buyerEmail: '[redacted]', id: 'ord_1' } } },
    });
  });

  it('redacts inside arrays too', () => {
    const event = { items: [{ phone: '11999998888', productId: 'p1' }] };

    expect(scrub(event)).toEqual({ items: [{ phone: '[redacted]', productId: 'p1' }] });
  });

  it('keeps everything an operator actually needs', () => {
    // The whole point of redacting by KEY rather than by value shape: an order
    // id, a charge id and an amount are what makes an event actionable, and a
    // tax id is eleven digits — so is plenty worth keeping.
    const event = {
      orderId: '89e40634-1234',
      providerChargeId: 'CHAR_1',
      amountCents: 1290,
      feature: 'payments',
    };

    expect(scrub(event)).toEqual(event);
  });

  it('redacts credentials, not only buyer data', () => {
    const event = { token: 'sk_live_abc', authorization: 'Bearer xyz', provider: 'infinitepay' };

    expect(scrub(event)).toEqual({
      token: '[redacted]',
      authorization: '[redacted]',
      provider: 'infinitepay',
    });
  });

  it('passes primitives through untouched', () => {
    expect(scrub('order creation failed')).toBe('order creation failed');
    expect(scrub(1290)).toBe(1290);
    expect(scrub(null)).toBeNull();
  });

  it('terminates on a self-referencing object instead of recursing forever', () => {
    // A logged error can hold a request that holds the client that holds the
    // request. The depth bound is what stops that taking the process with it.
    const loop: Record<string, unknown> = { orderId: 'ord_1' };
    loop['self'] = loop;

    expect(() => scrub(loop)).not.toThrow();
  });
});

describe('flushReporter — the drain before a deliberate exit', () => {
  /**
   * The SDK batches and sends asynchronously, so `log.error(…)` followed by
   * `process.exit(1)` tears the process down with the event still in memory.
   * That silently loses exactly the report worth having most: a process that
   * died on boot leaves nothing else behind. `server/index.ts` awaits this.
   */
  it('resolves true with reporting off, so a caller never has to ask', async () => {
    // The dev/CI/PR state. It must not hang, and must not make the caller
    // branch on whether a DSN happens to be set before it can exit.
    expect(sentryEnabled()).toBe(false);
    await expect(flushReporter()).resolves.toBe(true);
  });

  it('never rejects — a failed flush must not replace the real exit reason', async () => {
    // The caller is on its way to `process.exit(1)` because something ELSE
    // went wrong. A throw here would swap that cause for this one.
    vi.stubEnv('SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');
    await expect(flushReporter(1)).resolves.toEqual(expect.any(Boolean));
  });
});
