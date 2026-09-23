import { describe, expect, it } from 'vitest';

import { createSettingsService, credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryProviderConfigStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { TENANT, pixInput, cardInput } from './fixtures';
import { itauProvider } from '../providers/itau';
import { infinitePayProvider } from '../providers/infinitepay';
import { PT_BR_INFINITEPAY_COPY, PT_BR_ITAU_COPY } from '../providers/pt-BR';

/**
 * END-TO-END proof of the exact scenario the TASK describes, run against the
 * REAL gateway and the REAL `itau`/`infinitepay` adapters — no fakes, no
 * mocks of this package's own logic. Only the vendors' outermost HTTP calls
 * are replaced, via `credentials.stub` (the same boundary every other live
 * adapter's test suite already stubs at).
 *
 * A store enables Itaú FIRST (priority 0, PIX only) and InfinitePay SECOND
 * (priority 1, card-capable): exactly "Itaú é a primeira forma de pagamento,
 * e a loja também tem o InfinitePay ativo."
 */
async function storeWithItauFirstAndInfinitePaySecond() {
  const configStore = createMemoryProviderConfigStore();
  const providers = defineProviders({
    itau: itauProvider(PT_BR_ITAU_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  } as const);
  const settings = createSettingsService(providers, configStore, { allowStubMode: true });
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers,
    credentials: credentialStoreFrom(configStore, { allowStubMode: true }),
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });

  await settings.saveCredentials(TENANT, 'itau', { environment: 'SANDBOX', fields: {} });
  await settings.applyChargeVerification(TENANT, 'itau', true);
  await settings.saveCredentials(TENANT, 'infinitepay', { environment: 'SANDBOX', fields: {} });
  await settings.applyChargeVerification(TENANT, 'infinitepay', true);
  // List order IS priority order — Itaú named first is Itaú at priority 0,
  // "a primeira forma de pagamento" in exactly the words the task used.
  await settings.setPriorities(TENANT, ['itau', 'infinitepay']);

  return { gateway, charges, attempts };
}

describe('itau-first + infinitepay-second store: the exact task scenario', () => {
  it('step 2 "Pix": a PIX charge with no explicit provider settles at Itaú, QR carried locally on the snapshot (no redirect)', async () => {
    const { gateway } = await storeWithItauFirstAndInfinitePaySecond();
    const stored = await gateway.charge(TENANT, pixInput('order-pix-1'));
    expect(stored.snapshot.provider).toBe('itau');
    expect(stored.snapshot.method).toBe('PIX');
    // The QR is DATA on the snapshot, not a place to send the buyer — this is
    // the "gera o QR code localmente" half of the task: nothing here is a
    // `hostedCheckoutUrl`, so the host renders the QR ON the checkout screen.
    expect(stored.snapshot.pix?.qrText).toBeTruthy();
    expect(stored.snapshot.hostedCheckoutUrl).toBeUndefined();
  });

  it('step 2 "Cartão": a CARD charge with no explicit provider SKIPS Itaú (cannot do cards) and settles at InfinitePay', async () => {
    const { gateway } = await storeWithItauFirstAndInfinitePaySecond();
    const stored = await gateway.charge(TENANT, cardInput('order-card-1'));
    // This is the "se cartão então navega para o infinity pay" half — proven
    // by the ACTUAL routing decision the real gateway made walking the real
    // chain, not by a mock told to return this answer.
    expect(stored.snapshot.provider).toBe('infinitepay');
    expect(stored.snapshot.hostedCheckoutUrl).toBeTruthy();
  });

  it('the walk really TRIED Itaú first and skipped it for the card charge — not a coincidence of provider order elsewhere', async () => {
    const { gateway, attempts } = await storeWithItauFirstAndInfinitePaySecond();
    await gateway.charge(TENANT, cardInput('order-card-2'));
    const forThisCharge = attempts
      .all()
      .filter((a) => a.reference === 'order-card-2')
      .map((a) => [a.provider, a.outcome]);
    expect(forThisCharge).toEqual([
      ['itau', 'SKIPPED'],
      ['infinitepay', 'SUCCEEDED'],
    ]);
  });
});
