import { describe, expect, it } from 'vitest';

import { createTlsAsk } from '../domains/tls';
import { TenantConfigError } from '../validate';

describe('the TLS ask', () => {
  const askOf = () => createTlsAsk({
    servable: async (hostname) => (hostname === 'acme.com' ? { tenantId: 't1' } : hostname === 'late.com' ? { tenantId: 't2' } : null),
    entitled: async (tenantId) => tenantId === 't1',
  });

  it('allows only a servable domain of an entitled tenant', async () => {
    await expect(askOf().ask('acme.com')).resolves.toBe('allow');
    await expect(askOf().ask(' ACME.com ')).resolves.toBe('allow');
  });

  it('denies by default: an unknown name, and an unentitled tenant', async () => {
    await expect(askOf().ask('stranger.com')).resolves.toBe('unknown');
    await expect(askOf().ask('late.com')).resolves.toBe('unentitled');
  });

  it('never asks the plan about a name it does not serve', async () => {
    let asked = 0;
    const counted = createTlsAsk({ servable: async () => null, entitled: async () => (asked++, true) });
    await counted.ask('x.com');
    expect(asked).toBe(0);
  });

  it('refuses a missing member, named', () => {
    expect(() => createTlsAsk({ servable: async () => null } as never)).toThrow(TenantConfigError);
    try {
      createTlsAsk({ servable: async () => null } as never);
    } catch (error) {
      expect((error as TenantConfigError).key).toBe('entitled');
    }
  });
});
