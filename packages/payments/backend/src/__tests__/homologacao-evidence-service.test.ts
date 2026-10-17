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

function service(config = createMemoryProviderConfigStore()) {
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
    }),
  };
}

describe('createHomologacaoEvidence', () => {
  it('given a connected seller, then the view says so and never carries its token', async () => {
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

    const view = await service(config).svc.seller();

    expect(view).toEqual({
      connected: true,
      environment: 'SANDBOX',
      status: 'VERIFIED',
      connectedAt: '2026-10-17T15:00:00Z',
      accountId: 'ACCO_1',
      lastConnectProblem: null,
    });
    expect(JSON.stringify(view)).not.toContain('seller-secret');
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
