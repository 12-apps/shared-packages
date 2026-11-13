/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/fiscal
   routes and jobs through the harness's own app, over the generated Prisma client
   and the package's own migration. The cases build on one emitter profile, in order. */
/**
 * `@12-apps/fiscal` as a consumer installs it: the tarball's document service
 * over its own Prisma-backed store, its routes mounted under
 * `/api/admin/:tenantSlug`, and its jobs bound through the wiring consumer.
 * Nothing reaches a fiscal service: the issuer is the host's in-process fake
 * (`fiscal-ports.ts`). The package's behaviour is tested in the package; this
 * suite proves the adoption is live.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { FISCAL_PERMISSIONS_HEADER, FISCAL_TENANT, FISCAL_USER_HEADER } from '../src/fiscal-host';
import { CERTIFICATE_DAYS_LEFT, FISCAL_PROTOCOL } from '../src/fiscal-ports';

let backend: HarnessBackend;
const BASE = `/api/admin/${FISCAL_TENANT}/fiscal`;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

async function call(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await backend.app.request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(options.headers ?? { [FISCAL_USER_HEADER]: 'owner-1' }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const PROFILE = {
  cnpj: '12345678000195',
  stateRegistration: '0012345670',
  municipalRegistration: null,
  cnae: '5611201',
  legalName: 'Harness Comercio Ltda',
  tradeName: 'Harness',
  taxRegime: 'SIMPLES',
  regime: 'SIMPLES',
  regimeEffectiveFrom: '2026-01-01',
  restaurantRegime: false,
  address: {
    street: 'Rua das Flores',
    number: '100',
    complement: null,
    district: 'Centro',
    municipalityIbge: '3106200',
    municipalityName: 'Belo Horizonte',
    uf: 'MG',
    postalCode: '30110000',
    phone: null,
  },
  environment: 'homologacao',
  documentPolicy: 'ISSUED_HERE',
  signingIdentity: 'STORE_CERTIFICATE',
  cscId: null,
  cscToken: null,
  consentRecordedAt: null,
};

describe('the adoption', () => {
  it('assembles a clean report with every route claimed and the three jobs bound', () => {
    const fiscal = backend.hosts.fiscal;
    const [entry] = fiscal.report.packages;
    expect(entry?.packageName).toBe('@12-apps/fiscal');
    expect(entry?.capabilities.map((capability) => capability.status)).not.toContain('unbound');
    const claimed = fiscal.routes.map((r) => `${r.route.method} ${r.mountPath}${r.route.path}`);
    expect(unclaimedRoutes(fiscal.routes, claimed), renderWiringReport(fiscal.report)).toEqual([]);
    expect(fiscal.routes).toHaveLength(12);
    expect(fiscal.jobs.map((job) => job.name).sort()).toEqual([
      'fiscal.certificate-expiry',
      'fiscal.sweep',
      'fiscal.transmit-contingency',
    ]);
  });
});

describe('who may call', () => {
  it('refuses a caller with no session with a 401, before the package runs', async () => {
    expect((await call('GET', '/profile', { headers: {} })).status).toBe(401);
  });

  it('answers an authenticated read through the package: no profile yet', async () => {
    expect(await call('GET', '/profile')).toEqual({ status: 200, body: { data: null } });
  });

  it("refuses a write to a caller lacking the route's declared permission", async () => {
    const answer = await call('PUT', '/profile', {
      body: PROFILE,
      headers: { [FISCAL_USER_HEADER]: 'reader-1', [FISCAL_PERMISSIONS_HEADER]: 'fiscal:read' },
    });
    expect(answer).toEqual({ status: 403, body: { error: 'FORBIDDEN', permission: 'fiscal:manage' } });
  });
});

describe('issuing through the mounted routes', () => {
  it('saves the profile and its certificate, opens a point and issues an authorised NF-e', async () => {
    expect((await call('PUT', '/profile', { body: PROFILE })).status).toBe(200);
    const certified = await call('PUT', '/profile/certificate', { body: { pfxBase64: 'A'.repeat(120), password: 'segredo' } });
    expect(certified.status).toBe(200);
    expect(JSON.stringify(certified.body)).not.toContain('segredo');
    const point = await call('POST', '/issuing-points', {
      body: { id: 'caixa-1', model: 'NFE', onlineSeries: 1, contingencySeries: null, firstOnlineNumber: 1, firstContingencyNumber: 1 },
    });
    expect(point.status).toBe(201);

    const issued = await call('POST', '/documents', { body: { subjectId: 'sale-1', issuingPointId: 'caixa-1', model: 'NFE' } });

    expect(issued.status).toBe(200);
    expect(issued.body.data).toMatchObject({ status: 'AUTHORIZED', protocol: FISCAL_PROTOCOL, series: 1, number: 1 });
    expect(backend.hosts.fiscal.issuerCalls.map((entry) => entry.method)).toEqual(['issue']);
    const { rows } = await backend.pg.query<{ status: string; owner_id: string }>(
      "SELECT status, owner_id FROM fiscal_documents WHERE subject_id = 'sale-1'",
    );
    expect(rows).toEqual([{ status: 'AUTHORIZED', owner_id: FISCAL_TENANT }]);
  });
});

describe('the bound jobs', () => {
  it('tells the owner about the expiring certificate, in this host’s words', async () => {
    const fiscal = backend.hosts.fiscal;
    const job = fiscal.jobs.find((candidate) => candidate.name === 'fiscal.certificate-expiry');
    await job?.handle(undefined as never, { runId: 'r', attempt: 1, maxAttempts: 1, logger: console });

    expect(fiscal.notified).toEqual([
      expect.objectContaining({
        type: 'fiscal.certificate-expiring',
        recipient: { tenantId: FISCAL_TENANT, permission: 'fiscal:manage' },
        content: expect.objectContaining({ body: `Seu certificado A1 vence em ${CERTIFICATE_DAYS_LEFT} dia(s).` }),
      }),
    ]);
  });
});
