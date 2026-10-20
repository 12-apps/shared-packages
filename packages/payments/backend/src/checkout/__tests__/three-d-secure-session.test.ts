import { describe, expect, it } from 'vitest';

import { defineProviders } from '../../core/registry';
import { pagbankProvider } from '../../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../../providers/pt-BR';
import { call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * `POST /3ds-session` (FUT-3754) — the session a debit card's 3-D Secure SDK
 * runs on, minted with the credentials of the merchant whose payable it is.
 */
describe('POST /3ds-session', () => {
  const pagbank = { name: 'pagbank', adapter: pagbankProvider(PT_BR_PAGBANK_COPY) };

  it("answers the head provider's session for the caller's own payable", async () => {
    const { routes } = setupCheckoutWorld({
      chain: [pagbank],
      config: { providers: defineProviders({ pagbank: pagbank.adapter }) },
    });
    const answer = await call(routes, 'POST', '/3ds-session', { orderId: 'inv_2024_0043' });
    expect(answer.status).toBe(200);
    expect(answer.body.data).toMatchObject({
      provider: 'pagbank',
      session: 'stub-3ds-session',
      environment: 'SANDBOX',
    });
  });

  it('404s a payable that is not the caller’s, before any provider is asked', async () => {
    const { routes } = setupCheckoutWorld({
      chain: [pagbank],
      config: { providers: defineProviders({ pagbank: pagbank.adapter }) },
    });
    expect((await call(routes, 'POST', '/3ds-session', { orderId: 'someone-else' })).status).toBe(404);
  });

  it('answers not-configured when the head provider cannot do debit', async () => {
    const alpha = testAdapter('alpha');
    const { routes } = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: alpha }],
      config: { providers: defineProviders({ alpha }) },
    });
    const answer = await call(routes, 'POST', '/3ds-session', { orderId: 'inv_2024_0043' });
    expect(answer.status).toBe(409);
  });

  it('answers not-configured when the mount was given no adapters', async () => {
    const { routes } = setupCheckoutWorld({ chain: [pagbank] });
    expect((await call(routes, 'POST', '/3ds-session', { orderId: 'inv_2024_0043' })).status).toBe(409);
  });
});
