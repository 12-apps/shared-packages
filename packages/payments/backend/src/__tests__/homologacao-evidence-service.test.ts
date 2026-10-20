import { describe, expect, it, vi } from 'vitest';

import { createMemoryProviderConfigStore } from '../memory';
import {
  createHomologacaoEvidence,
  PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
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
      const matching = [...rows.values()].filter((row) => row.provider === where.provider && row.kind === where.kind);
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

function service(config = createMemoryProviderConfigStore(), extra: { applePayConfigured?: () => boolean } = {}) {
  const d = delegates();
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
      copy: PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
      newId: () => 'run-0000-0000',
      ...extra,
    }),
  };
}

async function connectedConfig() {
  const config = createMemoryProviderConfigStore();
  await config.save(SELLER, {
    provider: 'pagbank',
    enabled: true,
    priority: 0,
    environment: 'SANDBOX',
    status: 'VERIFIED',
    lastVerifiedAt: null,
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: false,
    environments: { SANDBOX: { token: 'seller-secret', accountId: 'ACCO_1', connectedAt: '2026-10-17T15:00:00Z' }, PRODUCTION: {} },
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
});
