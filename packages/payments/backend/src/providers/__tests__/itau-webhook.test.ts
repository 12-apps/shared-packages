import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WebhookDelivery } from '../../core/types';
import { STUB_CREDS } from '../../__tests__/fixtures';
import { itauProvider, NAME } from '../itau';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { E2E, paidCob, SANDBOX_CREDS, stubItauFetch, TXID } from './itau-fetch';

/**
 * The Itaú webhook: unsigned by design (BACEN registration takes a URL and
 * nothing else), so a delivery is believed only when Itaú confirms it when
 * re-asked, and what it reports comes from that answer, never the body.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function delivery(body: unknown): WebhookDelivery {
  return { provider: NAME, rawBody: typeof body === 'string' ? body : JSON.stringify(body), headers: {} };
}

const GENUINE = { pix: [{ endToEndId: E2E, txid: TXID, valor: '12.50', horario: '2026-09-30T12:00:00Z' }] };

describe('itau webhook verify', () => {
  it('accepts a delivery whose Pix the cob really received', async () => {
    const calls = stubItauFetch(() => ({ body: paidCob('12.50') }));
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(GENUINE), SANDBOX_CREDS)).resolves.toBe(true);
    expect(calls.at(-1)?.url).toMatch(new RegExp(`/cob/${TXID}$`));
  });

  it('needs no header at all — a genuine Itau delivery carries none a merchant could configure', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    const bare = { ...delivery(GENUINE), headers: {} };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(bare, SANDBOX_CREDS)).resolves.toBe(true);
  });

  it('refuses a forged end-to-end id the cob never received', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    const forged = { pix: [{ ...GENUINE.pix[0], endToEndId: 'E00000000FORGED' }] };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(forged), SANDBOX_CREDS)).resolves.toBe(false);
  });

  it('refuses the whole delivery when any one entry fails to confirm', async () => {
    stubItauFetch((call) => (call.url.endsWith(`/cob/${TXID}`) ? { body: paidCob('12.50') } : undefined));
    const mixed = { pix: [GENUINE.pix[0], { endToEndId: 'E2', txid: 'OTHERTXIDOTHERTXIDOTHERTXID1' }] };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(mixed), SANDBOX_CREDS)).resolves.toBe(false);
  });

  it('refuses a body that is not JSON, or names no cob', async () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    await expect(adapter.webhook.verify(delivery('not json'), SANDBOX_CREDS)).resolves.toBe(false);
    await expect(adapter.webhook.verify(delivery({ pix: [{ endToEndId: E2E }] }), SANDBOX_CREDS)).resolves.toBe(false);
  });

  it('refuses an oversized batch before spending a single call on it', async () => {
    const calls = stubItauFetch(() => ({ body: paidCob('12.50') }));
    const flood = { pix: Array.from({ length: 21 }, () => GENUINE.pix[0]) };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(flood), SANDBOX_CREDS)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a txid no real cob could carry, before any call', async () => {
    const calls = stubItauFetch(() => ({ body: paidCob('12.50') }));
    const bogus = { pix: [{ ...GENUINE.pix[0], txid: '..' }] };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(bogus), SANDBOX_CREDS)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reads each cob once, however many entries name it', async () => {
    const calls = stubItauFetch(() => ({ body: paidCob('12.50') }));
    const twice = { pix: [GENUINE.pix[0], GENUINE.pix[0]] };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(twice), SANDBOX_CREDS)).resolves.toBe(true);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
  });

  it('skips a Pix paid to the key without a cob, confirming the rest', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    const withStatic = { pix: [GENUINE.pix[0], { endToEndId: 'E60701190202609301200zzzzzzzzzzz', valor: '5.00' }] };
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(withStatic), SANDBOX_CREDS)).resolves.toBe(true);
  });

  it('fails closed when Itau cannot be asked', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery(GENUINE), SANDBOX_CREDS)).resolves.toBe(false);
  });

  it('trusts a stub delivery with no network call', async () => {
    const calls = stubItauFetch(() => undefined);
    await expect(itauProvider(PT_BR_ITAU_COPY).webhook.verify(delivery('{}'), STUB_CREDS)).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('itau webhook parse', () => {
  it('reports the amount Itau confirms, not the one the unsigned body claims', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    const inflated = { pix: [{ ...GENUINE.pix[0], valor: '9999.00' }] };
    const [event] = await itauProvider(PT_BR_ITAU_COPY).webhook.parse(delivery(inflated), SANDBOX_CREDS);
    expect(event).toMatchObject({
      type: 'CHARGE_UPDATED',
      eventId: `${E2E}:PAID`,
      charge: { providerChargeId: TXID, status: 'PAID', amount: { amountCents: 12_50 } },
    });
  });

  it('turns a devolução update into its own REFUND_UPDATED, keyed by the state it reports', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50', [{ id: 'D1', valor: '12.50', status: 'DEVOLVIDO' }]) }));
    const events = await itauProvider(PT_BR_ITAU_COPY).webhook.parse(delivery(GENUINE), SANDBOX_CREDS);
    expect(events.map((event) => [event.type, event.eventId])).toEqual([
      ['CHARGE_UPDATED', `${E2E}:REFUNDED`],
      ['REFUND_UPDATED', `${E2E}:D1:REFUNDED`],
    ]);
    expect(events[1]?.refund).toMatchObject({ providerChargeId: TXID, status: 'REFUNDED', amount: { amountCents: 12_50 } });
  });

  it('answers UNKNOWN for a delivery naming no cob, rather than throwing', async () => {
    const [event] = await itauProvider(PT_BR_ITAU_COPY).webhook.parse(delivery({ pix: [] }), SANDBOX_CREDS);
    expect(event?.type).toBe('UNKNOWN');
  });

  it('maps a stub delivery from the body, with no network call', async () => {
    const calls = stubItauFetch(() => undefined);
    const [event] = await itauProvider(PT_BR_ITAU_COPY).webhook.parse(delivery(GENUINE), STUB_CREDS);
    expect(event).toMatchObject({ type: 'CHARGE_UPDATED', charge: { status: 'PAID', amount: { amountCents: 12_50 } } });
    expect(calls).toHaveLength(0);
  });
});
