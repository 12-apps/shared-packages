import { describe, expect, it, vi } from 'vitest';

import { createMemoryProviderConfigStore } from '../memory';
import {
  createHomologacaoEvidence,
  EvidenceRunNotFoundError,
  PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  type EvidenceChargeDelegate,
  type EvidenceDelegate,
  type EvidenceWebhookDelegate,
} from '../platform/evidence/index';
import { PT_BR_CONNECT_APPLICATION_COPY } from '../platform/pt-BR';

/**
 * The mounted service (FUT-3696). Pinned: the seller view a screen gets never
 * carries the token, and the file reads the host's rows through the duck-typed
 * Prisma delegates — the evidence table, the webhook inbox and the charge row.
 */

const SELLER = { kind: 'PLATFORM', id: 'homologacao-seller' } as const;

function delegates() {
  const rows = new Map<string, Parameters<EvidenceDelegate['upsert']>[0]['create'] & { updatedAt: Date }>();
  const evidence: EvidenceDelegate = {
    findFirst: vi.fn(async ({ where }) => {
      const matching = [...rows.values()].filter(
        (row) => row.provider === where.provider && row.kind === where.kind && row.environment === where.environment,
      );
      return matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    }),
    upsert: vi.fn(async ({ create, update }) => {
      const row = { ...(rows.get(create.id) ?? create), ...update, updatedAt: new Date('2026-10-17T15:00:00Z') };
      rows.set(create.id, row);
      return row;
    }),
  };
  const webhookEvents: EvidenceWebhookDelegate = { findMany: vi.fn(async () => []) };
  const charges: EvidenceChargeDelegate = { findFirst: vi.fn(async () => null) };
  return { evidence, webhookEvents, charges };
}

function service(
  config = createMemoryProviderConfigStore(),
  extra: { applePayConfigured?: () => boolean; environment?: 'SANDBOX' | 'PRODUCTION' } = {},
  d = delegates(),
) {
  const appCredentials = () => ({ environment: 'SANDBOX' as const, fields: { clientId: 'cid', accountToken: 'platform-token' } });
  return {
    d,
    svc: createHomologacaoEvidence({
      gateway: { charge: vi.fn(), refreshCharge: vi.fn(), refund: vi.fn() },
      oauth: { begin: vi.fn(async () => ({ url: 'https://connect.sandbox.pagbank.com.br/oauth2/authorize?state=s', state: 's' })), complete: vi.fn(), refresh: vi.fn() },
      config,
      merchant: SELLER,
      prisma: { platformHomologationEvidence: d.evidence, paymentWebhookEvent: d.webhookEvents, paymentCharge: d.charges },
      appCredentials,
      consult: { appCredentials, expectedRedirectUri: 'https://x.test/cb', copy: PT_BR_CONNECT_APPLICATION_COPY },
      webhookUrl: 'https://x.test/api/webhooks/platform-homologacao/pagbank',
      identification: { name: 'Brand', site: 'https://x.test' },
      copy: extra.environment === 'PRODUCTION' ? PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY : PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
      newId: () => 'run-0000-0000',
      ...extra,
    }),
  };
}

async function connectedConfig(environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX') {
  const config = createMemoryProviderConfigStore();
  const fields = { token: 'seller-secret', accountId: 'ACCO_1', connectedAt: '2026-10-17T15:00:00Z' };
  await config.save(SELLER, {
    provider: 'pagbank',
    enabled: true,
    priority: 0,
    environment,
    status: 'VERIFIED',
    lastVerifiedAt: null,
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: false,
    environments: environment === 'SANDBOX' ? { SANDBOX: fields, PRODUCTION: {} } : { SANDBOX: {}, PRODUCTION: fields },
  });
  return config;
}

describe('createHomologacaoEvidence', () => {
  it('given a connected seller, then the view says so and never carries its token', async () => {
    const view = await service(await connectedConfig()).svc.seller();

    expect(view).toEqual({
      connected: true,
      environment: 'SANDBOX',
      status: 'VERIFIED',
      connectedAt: '2026-10-17T15:00:00Z',
      accountId: 'ACCO_1',
      lastConnectProblem: null,
      // Google Pay's sheet mints against the sandbox seller's account; no Apple Pay identity was given.
      wallets: {
        amountCents: 1200,
        googlePay: { gateway: 'pagbank', gatewayMerchantId: 'ACCO_1', environment: 'TEST' },
        applePay: { configured: false },
      },
    });
    expect(JSON.stringify(view)).not.toContain('seller-secret');
  });

  it('given the host says Apple Pay is configured, then the view says so (FUT-3755)', async () => {
    const view = await service(await connectedConfig(), { applePayConfigured: () => true }).svc.seller();

    expect(view.wallets.applePay).toEqual({ configured: true });
  });

  it('given no seller, then Google Pay has no account to mint against (FUT-3755)', async () => {
    const view = await service().svc.seller();

    expect(view.wallets).toEqual({ amountCents: 1200, googlePay: null, applePay: { configured: false } });
  });

  it('when connecting, then the record lands in the evidence table and the file reads it back', async () => {
    const { svc, d } = service();

    await svc.beginConnect({ state: 's', redirectUri: 'https://x.test/cb' });
    const file = await svc.file();

    expect(d.evidence.upsert).toHaveBeenCalledTimes(1);
    expect(file.content).toContain('client_id da aplicação: cid');
    expect(file.content).toContain('Callback (redirect_uri): https://x.test/cb');
    expect(file.content).toMatch(/Autorização da conta do lojista de teste .* — PENDENTE/);
  });

  it('given the sandbox evidence, then its rows are written and read as SANDBOX (FUT-4198)', async () => {
    const { svc, d } = service();

    await svc.beginConnect({ state: 's', redirectUri: 'https://x.test/cb' });
    await svc.file();

    expect(vi.mocked(d.evidence.upsert).mock.calls[0]![0].create.environment).toBe('SANDBOX');
    expect(vi.mocked(d.evidence.findFirst).mock.calls.every(([args]) => args.where.environment === 'SANDBOX')).toBe(true);
  });
});

describe('createHomologacaoEvidence in production (FUT-4198)', () => {
  const BUYER = {
    name: 'Ana Souza',
    email: 'ana@x.test',
    taxId: '12345678909',
    phone: '+5531999990000',
    billingAddress: { street: 'Rua A', number: '1', regionCode: 'MG', city: 'Belo Horizonte', postalCode: '30000000' },
  };

  function productionService(config = createMemoryProviderConfigStore(), d = delegates()) {
    return service(config, { environment: 'PRODUCTION', applePayConfigured: () => true }, d);
  }

  it('when connecting, then the authorization asks for PRODUCTION and its record is kept apart from the sandbox one', async () => {
    const d = delegates();
    const prod = productionService(undefined, d);
    const sandbox = service(undefined, {}, d);

    await prod.svc.beginConnect({ state: 's', redirectUri: 'https://x.test/cb' });

    expect(vi.mocked(d.evidence.upsert).mock.calls[0]![0].create.environment).toBe('PRODUCTION');
    expect((await sandbox.svc.file()).content).toMatch(/Autorização da conta do lojista de teste .* — PENDENTE/);
    expect((await sandbox.svc.file()).content).not.toContain('aguardando login e consentimento');
    expect((await prod.svc.file()).content).toContain('aguardando login e consentimento');
  });

  it('given a production seller, then its wallets charge R$ 1,00 and Google Pay runs in PRODUCTION', async () => {
    const view = await productionService(await connectedConfig('PRODUCTION')).svc.seller();

    expect(view.wallets).toEqual({
      amountCents: 100,
      googlePay: { gateway: 'pagbank', gatewayMerchantId: 'ACCO_1', environment: 'PRODUCTION' },
      applePay: { configured: true },
    });
  });

  it('given the cardholder, then phase 1 hands the browser their 3DS data for R$ 1,00', async () => {
    const prepared = await productionService().svc.prepare(BUYER);

    expect(prepared.debitTest).toEqual({
      amountCents: 100,
      customer: { name: 'Ana Souza', email: 'ana@x.test', phone: '+5531999990000' },
      billingAddress: BUYER.billingAddress,
    });
  });

  it('given no run, then confirming a Pix is refused', async () => {
    await expect(productionService().svc.confirmPix('run-0000-0000', 'CHECK')).rejects.toBeInstanceOf(EvidenceRunNotFoundError);
  });
});
