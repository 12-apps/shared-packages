import { describe, expect, it } from 'vitest';

import { TENANT, setupHttpWorld as setupHttp } from './fixtures';


const ctx = { merchant: TENANT };

function post(body: unknown): Request {
  return new Request('http://payments.test/', { method: 'POST', body: JSON.stringify(body) });
}

const CHARGE_BODY = {
  reference: 'order-1',
  amount: { amountCents: 12_50, currency: 'BRL' },
  method: 'PIX',
  customer: { name: 'Ana', email: 'ana@example.com' },
};

describe('createPaymentsHttp', () => {
  it('serves the client tokenization config', async () => {
    const { http } = await setupHttp();
    const res = await http.getClientConfig(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: 'stone', tokenization: 'PUBLIC_KEY' });
  });

  it('creates a charge and serves its client-safe view (no raw payload)', async () => {
    const { http } = await setupHttp();
    const created = await http.createCharge(post(CHARGE_BODY), ctx);
    expect(created.status).toBe(201);
    const view = (await created.json()) as { providerChargeId: string; pix?: { qrText: string } };
    expect(view.pix?.qrText).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain('"raw"');

    const fetched = await http.getCharge(ctx, 'stone', view.providerChargeId);
    expect(fetched.status).toBe(200);
  });

  it('ignores buyer-supplied amount and reference — the server decides', async () => {
    const { http, charges } = await setupHttp();
    // A tampered client tries to pay 1 cent, pointed at someone else's order.
    const tampered = await http.createCharge(
      post({ ...CHARGE_BODY, amount: { amountCents: 1, currency: 'BRL' }, reference: 'other-order' }),
      ctx,
    );
    expect(tampered.status).toBe(201);
    const stored = charges.all()[0];
    // The host resolver's values won, not the browser's.
    expect(stored?.snapshot.amount.amountCents).toBe(12_50);
    expect(stored?.reference).toBe('order-1');
  });

  it("hides another merchant's charge behind 404", async () => {
    const { http } = await setupHttp();
    const created = await http.createCharge(post(CHARGE_BODY), ctx);
    const view = (await created.json()) as { providerChargeId: string };
    const res = await http.getCharge(
      { merchant: { kind: 'TENANT', id: 'someone-else' } },
      'stone',
      view.providerChargeId,
    );
    expect(res.status).toBe(404);
  });

  it('processes a webhook delivery end to end and asks to be re-sent on refusal', async () => {
    const { http, charges } = await setupHttp();
    const created = await http.createCharge(post(CHARGE_BODY), ctx);
    const view = (await created.json()) as { providerChargeId: string };
    const delivery = post({
      eventId: 'evt-1',
      charge: {
        provider: 'stone',
        providerChargeId: view.providerChargeId,
        status: 'PAID',
        amount: CHARGE_BODY.amount,
        method: 'PIX',
      },
    });
    const res = await http.handleWebhook(delivery, ctx, 'stone');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    expect(charges.all()[0]?.snapshot.status).toBe('PAID');

    // 400, not the admin API's 409. This answer is read by a MACHINE deciding
    // whether to try again, and 400 is the one status InfinitePay documents as
    // "we will re-send" — while the activation gate was refusing confirmations
    // with a 409, real payments were told not to come back. Retrying is the
    // right outcome for nearly everything that can fail here; the one refusal
    // that must not invite one is an unknown store, which the host answers
    // before the request ever reaches this.
    const unknownMerchant = { merchant: { kind: 'TENANT', id: 'no-provider' } } as const;
    const denied = await http.handleWebhook(post({ eventId: 'evt-2' }), unknownMerchant, 'stone');
    expect(denied.status).toBe(400);
  });

  it('drives the settings surface over HTTP', async () => {
    const { http } = await setupHttp();
    const settingsRes = await http.getSettings(ctx);
    const view = (await settingsRes.json()) as { activeProvider: string | null };
    expect(view.activeProvider).toBe('stone');

    const saved = await http.saveCredentials(
      new Request('http://payments.test/', {
        method: 'PUT',
        body: JSON.stringify({ environment: 'SANDBOX', fields: { secretKey: 'sk_new_5678' } }),
      }),
      ctx,
      'stone',
    );
    const masked = (await saved.json()) as {
      environments: { SANDBOX: Record<string, { hint: string | null }> };
    };
    expect(masked.environments.SANDBOX['secretKey']?.hint).toBe('••••5678');

    const verified = await http.verify(ctx, 'stone');
    expect(((await verified.json()) as { status: string }).status).toBe('VERIFIED');

    const unknown = await http.verify(ctx, 'pagseguro');
    expect(unknown.status).toBe(404);
  });
});
