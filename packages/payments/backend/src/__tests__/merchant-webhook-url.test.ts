import { describe, expect, it } from 'vitest';

import { merchantWebhookUrl } from '../config/webhook-url';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';

/**
 * WHERE A MERCHANT'S WEBHOOKS LAND.
 *
 * Two rules that look like formatting and are not.
 *
 * A DECLARED path is a fact about a provider's install base: store owners typed
 * it into that provider's own dashboard, a page the platform cannot edit on
 * their behalf. Change it and their deliveries stop arriving, silently, until
 * somebody notices the orders never settle.
 *
 * An OVERRIDE replaces the origin and nothing else. The point of pointing a
 * tunnel at a deployment is to exercise the route production runs; a tunnel
 * that answered on a different path would prove nothing about the one that
 * matters.
 */

const GENERIC = (slug: string, provider: string) => `/api/webhooks/payments/${slug}/${provider}`;
const ORIGIN = 'https://shop.example';

function registry(adapters: Record<string, Partial<PaymentProviderAdapter>>) {
  return {
    has: (name: string) => name in adapters,
    get: (name: string) => adapters[name] as PaymentProviderAdapter,
  } as Pick<ProviderRegistry, 'has' | 'get'>;
}

/** An adapter that predates the generic route and names its historical path. */
const LEGACY = registry({
  pagbank: { webhookPath: (slug: string) => `/api/webhooks/pagseguro/${slug}/notifications` },
});

/** Every adapter written after the generic route existed. */
const MODERN = registry({ stone: {} });

describe('which path', () => {
  it("serves an adapter's declared path verbatim", () => {
    expect(merchantWebhookUrl(LEGACY, 'pagbank', 'bar-do-ze', { origin: ORIGIN, genericPath: GENERIC })).toBe(
      'https://shop.example/api/webhooks/pagseguro/bar-do-ze/notifications',
    );
  });

  it("falls back to the host's generic route when the adapter declares none", () => {
    expect(merchantWebhookUrl(MODERN, 'stone', 'bar-do-ze', { origin: ORIGIN, genericPath: GENERIC })).toBe(
      'https://shop.example/api/webhooks/payments/bar-do-ze/stone',
    );
  });

  /**
   * A setup guide renders this URL for an owner to copy, sometimes before any
   * store exists, with a literal placeholder standing in for the slug. Encoding
   * it would hand them a URL with `%7B` in it.
   */
  it('encodes nothing — a placeholder slug survives verbatim', () => {
    expect(
      merchantWebhookUrl(MODERN, 'stone', '{merchantSlug}', { origin: ORIGIN, genericPath: GENERIC }),
    ).toBe('https://shop.example/api/webhooks/payments/{merchantSlug}/stone');
  });

  it('takes the generic route for a provider the registry does not know', () => {
    // A guide can name a provider this deployment never registered; answering
    // with a plausible URL beats throwing at a caller that only wants a string.
    expect(merchantWebhookUrl(MODERN, 'unregistered', 'bar-do-ze', { origin: ORIGIN, genericPath: GENERIC })).toBe(
      'https://shop.example/api/webhooks/payments/bar-do-ze/unregistered',
    );
  });

  it('does not double the slash on an origin that carries one', () => {
    expect(merchantWebhookUrl(MODERN, 'stone', 'z', { origin: 'https://shop.example//', genericPath: GENERIC })).toBe(
      'https://shop.example/api/webhooks/payments/z/stone',
    );
  });
});

describe('the origin override', () => {
  it('replaces the origin and keeps the path byte-identical', () => {
    expect(
      merchantWebhookUrl(LEGACY, 'pagbank', 'bar-do-ze', {
        origin: ORIGIN,
        genericPath: GENERIC,
        originOverride: 'https://fp-abc.local.example',
      }),
    ).toBe('https://fp-abc.local.example/api/webhooks/pagseguro/bar-do-ze/notifications');
  });

  it('overrides a generic path the same way it overrides a declared one', () => {
    expect(
      merchantWebhookUrl(MODERN, 'stone', 'bar-do-ze', {
        origin: ORIGIN,
        genericPath: GENERIC,
        originOverride: 'https://fp-abc.local.example',
      }),
    ).toBe('https://fp-abc.local.example/api/webhooks/payments/bar-do-ze/stone');
  });

  it('discards any path the override itself carries', () => {
    // The override says WHERE, never WHAT. A path on it would silently change
    // the route under test, which is the one thing the tunnel exists to check.
    expect(
      merchantWebhookUrl(MODERN, 'stone', 'z', {
        origin: ORIGIN,
        genericPath: GENERIC,
        originOverride: 'https://tunnel.example/ignored/prefix',
      }),
    ).toBe('https://tunnel.example/api/webhooks/payments/z/stone');
  });

  it('ignores a blank override', () => {
    expect(
      merchantWebhookUrl(MODERN, 'stone', 'z', { origin: ORIGIN, genericPath: GENERIC, originOverride: '   ' }),
    ).toBe('https://shop.example/api/webhooks/payments/z/stone');
  });

  /** A misconfiguration is not an instruction — deliveries keep arriving. */
  it('falls back to the production URL when the override is unparsable', () => {
    expect(
      merchantWebhookUrl(MODERN, 'stone', 'z', {
        origin: ORIGIN,
        genericPath: GENERIC,
        originOverride: 'not a url',
      }),
    ).toBe('https://shop.example/api/webhooks/payments/z/stone');
  });
});
