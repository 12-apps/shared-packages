import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOAuthConnectService } from '../config/oauth';
import { credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import type { MerchantRef } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryProviderConfigStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { consultConnectApplication } from '../platform/connect-application';
import { PT_BR_CONNECT_APPLICATION_COPY } from '../platform/pt-BR';
import {
  beginSellerConnect,
  buildHomologacaoEvidenceFile,
  completeEvidenceRun,
  completeSellerConnect,
  createMemoryHomologacaoEvidenceStore,
  PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
  prepareEvidenceRun,
  type EvidenceWebhookEvent,
} from '../platform/evidence/index';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * The homologação evidence end to end (FUT-3696): the REAL PagBank adapter,
 * the real OAuth service and the real gateway, over memory stores — only
 * PagBank's far end is scripted. Pinned:
 *
 *  - every call in the file is one the production code path made, recorded
 *    with no token, code, secret or card blob in it;
 *  - the orders authenticate with the SELLER's token, never the platform's;
 *  - a step that did not run is PENDING, and the file says it is incomplete;
 *  - a refused consent, a state mismatch and a non-sandbox seller are
 *    recorded as what they were, never as success.
 */

const SELLER: MerchantRef = { kind: 'PLATFORM', id: 'homologacao-seller' };
const SECRETS = [
  'platform-account-token',
  'csecret-value',
  'auth-code-123',
  'seller-access-1',
  'seller-refresh-1',
  'seller-access-2',
  'seller-refresh-2',
  'enc-approved-blob',
  'enc-declined-blob',
];

function json(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

/** PagBank's sandbox, scripted per path — and every Authorization it was sent. */
function fakePagbank(options: { refreshStatus?: number; consultOutages?: number } = {}) {
  const seen: { path: string; authorization: string | null; body?: Record<string, unknown> }[] = [];
  let outages = options.consultOutages ?? 0;
  const pixPolls: number[] = [];
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    seen.push({ path: `${method} ${url.pathname}`, authorization: new Headers(init?.headers).get('authorization'), body });
    const route = `${method} ${url.pathname}`;
    if (route === 'POST /oauth2/token') {
      return json({ access_token: 'seller-access-1', refresh_token: 'seller-refresh-1', expires_in: 3600, account_id: 'ACCO_TEST' });
    }
    if (route === 'POST /oauth2/refresh') {
      if (options.refreshStatus) return json({ error: 'invalid_grant' }, options.refreshStatus, 'Bad Request');
      return json({ access_token: 'seller-access-2', refresh_token: 'seller-refresh-2', expires_in: 3600 });
    }
    if (route === 'GET /oauth2/application/cid') {
      return json({ client_id: 'cid', name: 'Paladira', redirect_uri: 'https://example.test/cb', client_secret: 'csecret-value' });
    }
    if (route === 'POST /public-keys') return json({ public_key: 'PUBKEY', created_at: 1 });
    if (route === 'POST /orders' && Array.isArray(body['qr_codes'])) {
      return json({ id: 'ORDE_PIX', reference_id: body['reference_id'], qr_codes: [{ id: 'QRCO_1', text: '00020101pix', expiration_date: '2026-10-17T12:15:00-03:00' }] }, 201, 'Created');
    }
    if (route === 'GET /orders/ORDE_PIX') {
      pixPolls.push(1);
      return json({
        id: 'ORDE_PIX',
        reference_id: 'r',
        charges: pixPolls.length > 1 ? [{ id: 'CHAR_PIX', status: 'PAID', amount: { value: 1000 } }] : [],
      });
    }
    if (route === 'POST /orders') {
      const charges = body['charges'] as { payment_method: { card: { encrypted: string } } }[];
      const approved = charges[0]!.payment_method.card.encrypted === 'enc-approved-blob';
      return json(
        {
          id: approved ? 'ORDE_C1' : 'ORDE_C2',
          charges: [
            {
              id: approved ? 'CHAR_OK' : 'CHAR_NO',
              status: approved ? 'PAID' : 'DECLINED',
              amount: { value: 1500, currency: 'BRL' },
              payment_response: approved ? { code: '20000', message: 'SUCESSO' } : { code: '10002', message: 'NAO AUTORIZADO' },
              payment_method: { type: 'CREDIT_CARD', card: { brand: 'visa', first_digits: '453962', last_digits: '2097' } },
            },
          ],
        },
        201,
        'Created',
      );
    }
    if (route === 'GET /orders/ORDE_C1') {
      if (outages > 0) {
        outages -= 1;
        return json({ error_messages: [{ code: 'SERVICE_UNAVAILABLE' }] }, 503, 'Service Unavailable');
      }
      return json({ id: 'ORDE_C1', charges: [{ id: 'CHAR_OK', status: 'PAID', amount: { value: 1500 } }] });
    }
    if (route === 'GET /charges/CHAR_OK') return json({ id: 'CHAR_OK', status: 'PAID', amount: { value: 1500 } });
    if (route === 'POST /charges/CHAR_OK/cancel') {
      return json({ id: 'CHAR_OK', status: 'CANCELED', amount: { value: 1500, summary: { refunded: 1500 } } }, 201, 'Created');
    }
    return json({ error: `unscripted ${route}` }, 404, 'Not Found');
  };
  return { handler, seen };
}

function world(options: { refreshStatus?: number; consultOutages?: number; sellerEnvironment?: 'SANDBOX' | 'PRODUCTION' } = {}) {
  const pagbank = fakePagbank(options);
  vi.stubGlobal('fetch', vi.fn(pagbank.handler));
  const providers = defineProviders({ pagbank: pagbankProvider(PT_BR_PAGBANK_COPY) });
  const configs = createMemoryProviderConfigStore();
  const appCreds = () => ({
    environment: 'SANDBOX' as const,
    fields: { clientId: 'cid', clientSecret: 'csecret-value', accountToken: 'platform-account-token' },
  });
  const oauth = createOAuthConnectService(providers, configs, appCreds);
  const gateway = createPaymentsGateway({
    providers,
    credentials: credentialStoreFrom(configs),
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  const store = createMemoryHomologacaoEvidenceStore();
  const ids = ['00000000-run-1', '00000000-run-2', '00000000-run-3', '00000000-run-4'];
  let next = 0;
  const newId = (): string => ids[next++ % ids.length]!;
  const copy = PT_BR_HOMOLOGACAO_EVIDENCE_COPY;
  const connectDeps = {
    oauth,
    config: configs,
    merchant: SELLER,
    store,
    copy: copy.outcome,
    newId,
    webhookUrl: 'https://example.test/api/webhooks/platform-homologacao/pagbank',
  };
  const runDeps = {
    merchant: SELLER,
    store,
    copy: copy.outcome,
    newId,
    gateway,
    oauth,
    seller: async () => {
      const stored = await configs.get(SELLER, 'pagbank');
      if (!stored) return null;
      return {
        environment: options.sellerEnvironment ?? stored.environment,
        token: stored.environments[stored.environment]?.['token'] ?? null,
      };
    },
    platformToken: async () => 'platform-account-token',
    consultApplication: () =>
      consultConnectApplication(
        { appCredentials: appCreds, expectedRedirectUri: 'https://example.test/cb', copy: PT_BR_CONNECT_APPLICATION_COPY },
        'SANDBOX',
      ),
    customer: { name: 'Jose da Silva', email: 'cliente@sandbox.pagseguro.com.br', taxId: '12345678909' },
    sleep: async () => undefined,
    pixPolls: 3,
  };
  const events: EvidenceWebhookEvent[] = [];
  const fileDeps = {
    store,
    copy,
    identification: { name: 'Paladira', site: 'https://paladira.com', clientId: 'cid', callbackUrl: 'https://example.test/cb' },
    webhookEvents: async (wanted: readonly string[]) =>
      events.filter((event) => wanted.some((id) => JSON.stringify(event.payload).includes(id))),
    chargeRow: async () => ({ providerChargeId: 'CHAR_PIX', status: 'PAID', updatedAt: new Date('2026-10-17T15:00:02Z') }),
  };
  return { pagbank, configs, connectDeps, runDeps, fileDeps, events };
}

function cards() {
  return [
    { scenario: 'approved' as const, brand: 'VISA', masked: '4539 62** **** 2097', encrypted: 'enc-approved-blob' },
    { scenario: 'declined' as const, brand: 'VISA', masked: '4929 29** **** 0766', encrypted: 'enc-declined-blob' },
  ];
}

async function connected(w: ReturnType<typeof world>) {
  await beginSellerConnect(w.connectDeps, { state: 'st-1', redirectUri: 'https://example.test/cb' });
  return completeSellerConnect(w.connectDeps, {
    callbackUrl: 'https://example.test/cb?code=auth-code-123&state=st-1',
    code: 'auth-code-123',
    error: null,
    stateMatched: true,
    state: 'st-1',
    redirectUri: 'https://example.test/cb',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('homologação evidence', () => {
  it('given a connected seller and a full run, then every scenario but the webhooks is EXECUTED and no secret is in the file', async () => {
    const w = world();
    expect((await connected(w)).ok).toBe(true);

    const prepared = await prepareEvidenceRun(w.runDeps);
    expect(prepared.publicKey).toBe('PUBKEY');
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.summary).toEqual({ executed: 15, failed: 0, pending: 2 });
    for (const secret of SECRETS) expect(file.content).not.toContain(secret);
    expect(file.content).toContain('POST https://sandbox.api.pagseguro.com/oauth2/token');
    expect(file.content).toContain('code=***REDACTED***');
    expect(file.content).toContain('"capture": true');
    expect(file.content).toContain('"notification_urls": [\n    "https://example.test/api/webhooks/platform-homologacao/pagbank"');
    expect(file.content).toContain('"code": "10002"');
    expect(file.content).toContain('ARQUIVO INCOMPLETO: 2 cenários pendentes e 0 com falha');
    expect(file.content).toContain('não garante a aprovação');
    expect(file.content).toMatch(/\(GMT-03:00, America\/Sao_Paulo\)/);
  });

  it('given PagBank answers the card consult 503 once, then it is retried and both calls are recorded (FUT-3722)', async () => {
    const w = world({ consultOutages: 1 });
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(w.pagbank.seen.filter((call) => call.path === 'GET /orders/ORDE_C1')).toHaveLength(2);
    expect(file.content).toContain('Status HTTP: 503 Service Unavailable');
    expect(file.content).toMatch(/\[4\.4\][^\n]*— EXECUTADO/);
  });

  it('given a cancel, then it names the charge amount PagBank documents (FUT-3722)', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());

    const cancel = w.pagbank.seen.find((call) => call.path === 'POST /charges/CHAR_OK/cancel');
    expect(cancel?.body).toEqual({ amount: { value: 1500 } });
  });

  it('given the card orders, then each card step names the order PagBank created and encryption comes first (FUT-3722)', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).toContain('IDs para correlação: order_id=ORDE_C1, charge_id=CHAR_OK, reference_id=');
    expect(file.content).toContain('IDs para correlação: order_id=ORDE_C2, charge_id=CHAR_NO, reference_id=');
    expect(file.content).toMatch(/Pedido consultado \d+ vezes; status final PAID/);
    expect(file.content).not.toMatch(/\((s|es|ões)\)/);
  });

  it('given a completed connect, then the seller row is enabled and addressed to its own webhook route', async () => {
    const w = world();
    await connected(w);

    const row = await w.configs.get(SELLER, 'pagbank');

    expect(row).toMatchObject({ enabled: true, environment: 'SANDBOX', status: 'VERIFIED' });
    expect(row?.environments.SANDBOX['notificationUrl']).toBe('https://example.test/api/webhooks/platform-homologacao/pagbank');
  });

  it('given the orders, then each one carried the seller token and none the platform token', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());

    const orderCalls = w.pagbank.seen.filter((call) => /\/(orders|charges|public-keys)/.test(call.path));
    expect(orderCalls.length).toBeGreaterThan(0);
    expect(orderCalls.every((call) => call.authorization === 'Bearer seller-access-2')).toBe(true);
  });

  it('given a webhook delivery for the Pix order, then the Pix webhook step is EXECUTED with what it moved', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());
    w.events.push({
      receivedAt: new Date('2026-10-17T15:00:00Z'),
      processedAt: new Date('2026-10-17T15:00:01Z'),
      status: 'PROCESSED',
      payload: { id: 'ORDE_PIX', charges: [{ id: 'CHAR_PIX', status: 'PAID' }] },
    });

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.summary.pending).toBe(1);
    expect(file.content).toContain('1 notificação recebida e armazenada (situação: PROCESSED)');
  });

  it('given nothing has run, then every scenario is PENDING and the file says so', async () => {
    const w = world();

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.summary).toEqual({ executed: 0, failed: 0, pending: 17 });
    expect(file.content).toContain('ARQUIVO INCOMPLETO: 17 cenários pendentes');
    expect(file.content).toContain('Situação: INCOMPLETO — 0 executados · 0 com falha · 17 pendentes');
    // Nothing ran, so no test time is claimed for either group.
    expect(file.content).toContain('Data e hora dos testes — Connect: não executado · Pix e cartão: não executado');
    expect(file.content).not.toMatch(/Horário: \d/);
  });

  it('given a refused consent, then authorize FAILED and the exchange never ran', async () => {
    const w = world();
    await beginSellerConnect(w.connectDeps, { state: 'st-1', redirectUri: 'https://example.test/cb' });

    const result = await completeSellerConnect(w.connectDeps, {
      callbackUrl: 'https://example.test/cb?error=access_denied&state=st-1',
      code: null,
      error: 'access_denied',
      stateMatched: true,
      state: 'st-1',
      redirectUri: 'https://example.test/cb',
    });

    expect(result.ok).toBe(false);
    const byKey = Object.fromEntries(result.record.steps.map((step) => [step.key, step.status]));
    expect(byKey).toMatchObject({ 'connect.authorize': 'FAILED', 'connect.exchange': 'PENDING' });
    expect(w.pagbank.seen.some((call) => call.path === 'POST /oauth2/token')).toBe(false);
    // The callback line says what actually arrived: an error, never a code.
    const callback = result.record.steps.find((step) => step.key === 'connect.callback');
    expect(callback?.observed).toContain('sem code (error=access_denied)');
    expect(callback?.observed).not.toContain('code (removido)');
  });

  it('given a state mismatch, then the code is never exchanged', async () => {
    const w = world();

    const result = await completeSellerConnect(w.connectDeps, {
      callbackUrl: 'https://example.test/cb?code=auth-code-123&state=forged',
      code: 'auth-code-123',
      error: null,
      stateMatched: false,
      state: 'forged',
      redirectUri: 'https://example.test/cb',
    });

    expect(result.ok).toBe(false);
    expect(w.pagbank.seen).toHaveLength(0);
    expect(JSON.stringify(result.record)).not.toContain('auth-code-123');
  });

  it('given a refresh PagBank refuses, then the refresh step is FAILED, not hidden', async () => {
    const w = world({ refreshStatus: 400 });
    await connected(w);

    await prepareEvidenceRun(w.runDeps);
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).toMatch(/Renovação do token do lojista — POST \/oauth2\/refresh — FALHOU/);
  });

  it('given a seller whose connection is not a sandbox one, then nothing is sent to PagBank', async () => {
    const w = world({ sellerEnvironment: 'PRODUCTION' });
    await connected(w);
    const before = w.pagbank.seen.length;

    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());

    expect(prepared.publicKey).toBeNull();
    expect(w.pagbank.seen).toHaveLength(before);
  });

  it('given the browser could not encrypt, then the card scenarios are PENDING with the reason', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);

    await completeEvidenceRun(
      w.runDeps,
      prepared.runId,
      cards().map((card) => ({ ...card, encrypted: null, failure: 'SDK_UNAVAILABLE' as const })),
    );
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).toContain('o SDK do PagBank não carregou no navegador');
    expect(w.pagbank.seen.some((call) => call.path === 'POST /orders' && call.authorization)).toBe(true);
    expect(file.content).toMatch(/Pedido com cartão de crédito aprovado .* — PENDENTE/);
  });

  it('given a second phase 2 on the same run, then it is refused and the first recording stands', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());

    await expect(completeEvidenceRun(w.runDeps, prepared.runId, cards())).rejects.toMatchObject({
      name: 'EvidenceRunNotFoundError',
    });
    expect((await buildHomologacaoEvidenceFile(w.fileDeps)).summary.executed).toBe(15);
  });

  it('given the orders, then usage is proven from the fingerprint each call carried, never the token', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).toMatch(/\[2\.6\] Uso da autorização do lojista nos pedidos — EXECUTADO/);
    expect(file.content).toMatch(/authorization: Bearer \*\*\*REDACTED\*\*\* \(sha256:[0-9a-f]{12}\)/);
    expect(file.content).not.toContain('seller-access-2');
  });

  it('given a seller whose token is the platform token, then no order is raised and the file says why', async () => {
    const w = world();
    await connected(w);
    const runDeps = { ...w.runDeps, platformToken: async () => 'seller-access-2' };
    const prepared = await prepareEvidenceRun(runDeps);
    const before = w.pagbank.seen.filter((call) => call.path === 'POST /orders').length;

    await completeEvidenceRun(runDeps, prepared.runId, cards());

    expect(prepared.publicKey).toBeNull();
    expect(w.pagbank.seen.filter((call) => call.path === 'POST /orders').length).toBe(before);
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);
    expect(file.content).toMatch(/\[2\.6\] Uso da autorização do lojista nos pedidos — FALHOU/);
    expect(file.content).toContain('igual ao da plataforma');
  });

  it('given a delivery the inbox has not processed, then the webhook step stays PENDING', async () => {
    const w = world();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, prepared.runId, cards());
    w.events.push({
      receivedAt: new Date('2026-10-17T15:00:00Z'),
      processedAt: null,
      status: 'PENDING',
      payload: { id: 'ORDE_PIX' },
    });

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).toContain('ainda não processada');
    expect(file.summary.pending).toBe(2);
  });

  it('given the seller row cannot be enabled, then the exchange is recorded and the connect is not ok', async () => {
    const w = world();
    await beginSellerConnect(w.connectDeps, { state: 'st-1', redirectUri: 'https://example.test/cb' });
    const failing = { ...w.connectDeps, config: { save: async () => Promise.reject(new Error('serialization failure')) } };

    const result = await completeSellerConnect(failing, {
      callbackUrl: 'https://example.test/cb?code=auth-code-123&state=st-1',
      code: 'auth-code-123',
      error: null,
      stateMatched: true,
      state: 'st-1',
      redirectUri: 'https://example.test/cb',
    });

    expect(result.ok).toBe(false);
    const exchange = result.record.steps.find((step) => step.key === 'connect.exchange');
    expect(exchange?.status).toBe('EXECUTED');
    expect(exchange?.notes.join(' ')).toContain('serialization failure');
  });

  it('given the open authorize URL, then its state is not in the record', async () => {
    const w = world();

    await beginSellerConnect(w.connectDeps, { state: 'live-state-123', redirectUri: 'https://example.test/cb' });

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);
    expect(file.content).not.toContain('live-state-123');
    expect(file.content).toContain('state=***REDACTED***');
  });
});
