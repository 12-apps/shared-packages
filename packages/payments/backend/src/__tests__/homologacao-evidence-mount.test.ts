import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHomologacaoEvidenceMount } from '../platform/evidence/mount';
import { PT_BR_HOMOLOGACAO_EVIDENCE_COPY, PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY } from '../platform/evidence/index';
import type { HomologacaoEvidenceConfig } from '../platform/evidence/service';

const create = vi.hoisted(() => vi.fn((cfg: unknown) => ({ cfg })));
vi.mock('../platform/evidence/service', async (actual) => ({
  ...(await actual<typeof import('../platform/evidence/service')>()),
  createHomologacaoEvidence: create,
}));

beforeEach(() => {
  create.mockClear();
});

/**
 * The host-side mount of the homologação evidence (FUT-4198). Pinned: each
 * environment gets its own seller, its own state cookie on the host's one
 * callback, its own webhook URL and copy pack, and `?ambiente=producao` is the
 * only way a request reaches the production evidence.
 */

const mountFor = () =>
  createHomologacaoEvidenceMount({
    cookiePrefix: 'host_homolog_oauth',
    callbackPath: '/api/payments/oauth/callback',
    webhookPath: '/api/webhooks/platform-homologacao',
    baseUrl: () => 'https://host.test',
    deps: async () => ({ identification: { name: 'Host', site: 'https://host.test' } }) as never,
  });

describe('createHomologacaoEvidenceMount', () => {
  it('given each environment, then its seller and its state cookie are its own', () => {
    const mount = mountFor();
    expect(mount.seller('SANDBOX')).toEqual({ kind: 'PLATFORM', id: 'homologacao-seller' });
    expect(mount.seller('PRODUCTION')).toEqual({ kind: 'PLATFORM', id: 'homologacao-seller-production' });
    expect(mount.connectState('SANDBOX').stateCookieName('pagbank')).toBe('host_homolog_oauth_pagbank');
    expect(mount.connectState('PRODUCTION').stateCookieName('pagbank')).toBe('host_homolog_oauth_prod_pagbank');
    expect(mount.connectState('PRODUCTION').redirectUri('pagbank')).toBe(mount.connectState('SANDBOX').redirectUri('pagbank'));
  });

  it('given a request, then only ?ambiente=producao reaches the production evidence', () => {
    const mount = mountFor();
    expect(mount.environmentOf(new Request('https://host.test/x?ambiente=producao'))).toBe('PRODUCTION');
    expect(mount.environmentOf(new Request('https://host.test/x?ambiente=sandbox'))).toBe('SANDBOX');
    expect(mount.environmentOf(new Request('https://host.test/x'))).toBe('SANDBOX');
  });

  it('given a service per environment, then each carries its seller, webhook URL and copy pack', async () => {
    const mount = mountFor();
    await mount.evidence();
    await mount.evidence('PRODUCTION');

    const built = create.mock.calls.map(([cfg]) => cfg as HomologacaoEvidenceConfig);
    expect(built.map((cfg) => [cfg.environment, cfg.merchant.id, cfg.webhookUrl])).toEqual([
      ['SANDBOX', 'homologacao-seller', 'https://host.test/api/webhooks/platform-homologacao/pagbank'],
      ['PRODUCTION', 'homologacao-seller-production', 'https://host.test/api/webhooks/platform-homologacao-producao/pagbank'],
    ]);
    expect(built[0]?.copy).toBe(PT_BR_HOMOLOGACAO_EVIDENCE_COPY);
    expect(built[1]?.copy).toBe(PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY);
    expect(built[1]?.identification.name).toBe('Host');
  });
});
