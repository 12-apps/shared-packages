import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPLIT_ARRANGEMENTS, type FiscalSplitInput } from '../core/fiscal-split';
import type { ChargeInput } from '../core/types';
import { allProviderAdapters } from '../providers/catalog';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY, PT_BR_PROVIDER_COPY } from '../providers/pt-BR';
import { cardInput, pixInput } from './fixtures';

/**
 * FUT-2239 — the tax a charge informs to the split payment. Informing nothing is
 * the legal default (LC 214/2025 art. 33 §2-A), so the fields reach the wire
 * ONLY when the host passes `fiscalSplit` AND the adapter was built with the
 * stub field set; every other combination sends none of them.
 */

const LIVE = { environment: 'SANDBOX' as const, fields: { token: 'tok_live', webhookToken: 'wh' } };
const SPLIT: FiscalSplitInput = { cbsInformedCents: 66, ibsInformedCents: 1, documentKey: null };

function sentBody(input: ChargeInput, options?: Parameters<typeof pagbankProvider>[1]) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      id: 'ORDE_1',
      charges: [{ id: 'CHAR_1', status: input.method === 'PIX' ? 'WAITING' : 'PAID', qr_code: { id: 'QRCO_1', text: 'emv' } }],
    }),
    text: async () => '{}',
  });
  vi.stubGlobal('fetch', spy);
  return pagbankProvider(PT_BR_PAGBANK_COPY, options)
    .createCharge(input, LIVE)
    .then(() => JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<Record<string, unknown>>;
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank adapter — fiscal split pass-through (FUT-2239)', () => {
  it('Given no fiscalSplit, Then the Pix request carries no splitFiscal, whatever the field set', async () => {
    const body = await sentBody(pixInput(), { fiscalSplitFields: 'stub' });
    expect(body.charges[0]).not.toHaveProperty('splitFiscal');
  });

  it('Given a fiscalSplit and the default field set, Then nothing is sent (no published mapping yet)', async () => {
    const body = await sentBody({ ...pixInput(), fiscalSplit: SPLIT });
    expect(body.charges[0]).not.toHaveProperty('splitFiscal');
  });

  it('Given a fiscalSplit and the stub field set, Then the Pix charge carries the CGIBS names', async () => {
    const body = await sentBody(
      { ...pixInput(), fiscalSplit: { ...SPLIT, documentKey: '3'.repeat(44) } },
      { fiscalSplitFields: 'stub' },
    );
    expect(body.charges[0]?.['splitFiscal']).toEqual({ vlCbsInf: 66, vlIbsInf: 1, docFiscal: '3'.repeat(44) });
  });

  it('Given a fiscalSplit and the stub field set on PRODUCTION credentials, Then nothing is sent (stub names are unofficial)', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'WAITING', qr_code: { id: 'QRCO_1', text: 'emv' } }] }),
      text: async () => '{}',
    });
    vi.stubGlobal('fetch', spy);
    await pagbankProvider(PT_BR_PAGBANK_COPY, { fiscalSplitFields: 'stub' }).createCharge(
      { ...pixInput(), fiscalSplit: SPLIT },
      { ...LIVE, environment: 'PRODUCTION' as const },
    );
    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<Record<string, unknown>>;
    };
    expect(body.charges[0]).not.toHaveProperty('splitFiscal');
  });

  it('Given a card charge with a fiscalSplit and the stub field set, Then nothing is sent (a card is no arrangement)', async () => {
    const body = await sentBody({ ...cardInput(), fiscalSplit: SPLIT }, { fiscalSplitFields: 'stub' });
    expect(body.charges[0]).not.toHaveProperty('splitFiscal');
  });
});

describe('capabilities contract — split arrangements (FUT-2239)', () => {
  for (const adapter of allProviderAdapters(PT_BR_PROVIDER_COPY)) {
    it(`${adapter.name}: every declared arrangement is an RCBS one its methods can charge`, () => {
      for (const arrangement of adapter.capabilities.splitArrangements ?? []) {
        expect(SPLIT_ARRANGEMENTS).toContain(arrangement);
        const method = arrangement === 'BOLETO' ? 'BOLETO' : arrangement.startsWith('PIX') ? 'PIX' : null;
        if (method) expect(adapter.capabilities.methods).toContain(method);
      }
    });
  }

  it('PagBank built with the stub field set declares the dynamic Pix QR it mints, and nothing else', () => {
    expect(pagbankProvider(PT_BR_PAGBANK_COPY, { fiscalSplitFields: 'stub' }).capabilities.splitArrangements).toEqual([
      'PIX_DINAMICO',
    ]);
  });

  it('PagBank built without the stub field set declares no arrangement (it would write nothing)', () => {
    expect(pagbankProvider(PT_BR_PAGBANK_COPY).capabilities.splitArrangements ?? []).toEqual([]);
    expect(pagbankProvider(PT_BR_PAGBANK_COPY, { fiscalSplitFields: 'none' }).capabilities.splitArrangements ?? []).toEqual(
      [],
    );
  });
});
