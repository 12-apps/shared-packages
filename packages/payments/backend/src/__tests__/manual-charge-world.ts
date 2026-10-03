import { vi } from 'vitest';

import { createSettingsService, credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import type { WebhookEventHandler } from '../core/ports';
import { defineProviders } from '../core/registry';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryProviderConfigStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { infinitePayProvider } from '../providers/infinitepay';
import { itauProvider } from '../providers/itau';
import { PT_BR_PIX_MANUAL_COPY } from '../providers/pix-manual/pt-BR';
import { pixManualProvider } from '../providers/pixmanual';
import { PT_BR_INFINITEPAY_COPY, PT_BR_ITAU_COPY } from '../providers/pt-BR';
import { TENANT, pixInput } from './fixtures';

/**
 * A store with Pix manual (and optionally Itaú and InfinitePay behind it),
 * wired through the REAL settings service and gateway — shared by every
 * manual-charge suite.
 */

export const CONFIGURED = { pixKey: 'loja@example.com', merchantName: 'Padaria Boa', merchantCity: 'Recife' };

type Chain = ReadonlyArray<'pixmanual' | 'itau' | 'infinitepay'>;

export async function store(chain: Chain = ['pixmanual'], onWebhookEvent?: WebhookEventHandler) {
  const configStore = createMemoryProviderConfigStore();
  const providers = defineProviders({
    pixmanual: pixManualProvider(PT_BR_PIX_MANUAL_COPY),
    itau: itauProvider(PT_BR_ITAU_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  } as const);
  const settings = createSettingsService(providers, configStore, { allowStubMode: true });
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const credentials = credentialStoreFrom(configStore, { allowStubMode: true });
  const handler = onWebhookEvent ?? vi.fn<WebhookEventHandler>(async () => undefined);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
    onWebhookEvent: handler,
  });
  for (const name of chain) {
    // Pix manual has no sandbox (every code is real money); the stubbed vendors run in theirs.
    await settings.saveCredentials(TENANT, name, {
      environment: name === 'pixmanual' ? 'PRODUCTION' : 'SANDBOX',
      fields: name === 'pixmanual' ? CONFIGURED : {},
    });
    if (name === 'infinitepay') await settings.applyChargeVerification(TENANT, name, true);
    else await settings.setEnabled(TENANT, name, true);
  }
  await settings.setPriorities(TENANT, [...chain]);
  return { gateway, charges, attempts, handler, providers, configStore, credentials };
}

export async function raisedPix(world: Awaited<ReturnType<typeof store>>, reference = 'order-1') {
  const stored = await world.gateway.charge(TENANT, pixInput(reference));
  return stored.snapshot.providerChargeId;
}
