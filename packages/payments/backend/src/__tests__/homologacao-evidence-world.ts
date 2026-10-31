import { vi } from 'vitest';

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
  completeSellerConnect,
  createMemoryHomologacaoEvidenceStore,
  PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
  type BrowserCardResult,
  type BrowserWalletResult,
  type EvidenceWebhookEvent,
} from '../platform/evidence/index';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * The homologação evidence's world (FUT-3696, FUT-3755): the REAL PagBank
 * adapter, the real OAuth service and the real gateway, over memory stores —
 * only PagBank's far end is scripted. Shared by the evidence suites so the
 * wallet sections run against the same sandbox the card sections do.
 */

export const SELLER: MerchantRef = { kind: 'PLATFORM', id: 'homologacao-seller' };
export const SECRETS = [
  'platform-account-token',
  'csecret-value',
  'auth-code-123',
  'seller-access-1',
  'seller-refresh-1',
  'seller-access-2',
  'seller-refresh-2',
  'enc-approved-blob',
  'enc-declined-blob',
  'enc-debit-blob',
  'gpay-token-secret',
  'apay-payment-data-secret',
];

function json(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

/** The debit card's order, consult and cancel (FUT-3755), or null for any other route. */
function debitAnswer(route: string, body: Record<string, unknown>): Response | null {
  const charges = body['charges'] as { payment_method?: { type?: string } }[] | undefined;
  if (route === 'POST /orders' && charges?.[0]?.payment_method?.type === 'DEBIT_CARD') {
    const charge = {
      id: 'CHAR_DEB',
      status: 'PAID',
      amount: { value: 2701, currency: 'BRL' },
      payment_response: { code: '20000', message: 'SUCESSO' },
      payment_method: { type: 'DEBIT_CARD', card: { brand: 'visa', first_digits: '400000', last_digits: '2701' } },
    };
    return json({ id: 'ORDE_D1', charges: [charge] }, 201, 'Created');
  }
  if (route === 'GET /orders/ORDE_D1') {
    return json({ id: 'ORDE_D1', charges: [{ id: 'CHAR_DEB', status: 'PAID', amount: { value: 2701 } }] });
  }
  if (route === 'POST /charges/CHAR_DEB/cancel') {
    return json({ id: 'CHAR_DEB', status: 'CANCELED', amount: { value: 2701, summary: { refunded: 2701 } } }, 201, 'Created');
  }
  return null;
}

/** A wallet order (FUT-3755): which order and charge the sandbox answers for each wallet. */
const WALLET_ORDERS = {
  GOOGLE_PAY: { order: 'ORDE_G1', charge: 'CHAR_GP' },
  APPLE_PAY: { order: 'ORDE_A1', charge: 'CHAR_AP' },
} as const;

/** The wallet orders' create, consult and cancel (FUT-3755), or null for any other route. */
function walletAnswer(route: string, body: Record<string, unknown>): Response | null {
  const charges = body['charges'] as { payment_method?: { card?: { wallet?: { type?: string } } } }[] | undefined;
  const type = charges?.[0]?.payment_method?.card?.wallet?.type as keyof typeof WALLET_ORDERS | undefined;
  if (route === 'POST /orders' && type && WALLET_ORDERS[type]) {
    const { order, charge } = WALLET_ORDERS[type];
    const paid = { id: charge, status: 'PAID', amount: { value: 1200, currency: 'BRL' }, payment_response: { code: '20000', message: 'SUCESSO' } };
    return json({ id: order, charges: [paid] }, 201, 'Created');
  }
  for (const { order, charge } of Object.values(WALLET_ORDERS)) {
    if (route === `GET /orders/${order}`) return json({ id: order, charges: [{ id: charge, status: 'PAID', amount: { value: 1200 } }] });
    if (route === `POST /charges/${charge}/cancel`) {
      return json({ id: charge, status: 'CANCELED', amount: { value: 1200, summary: { refunded: 1200 } } }, 201, 'Created');
    }
  }
  return null;
}

/** PagBank's sandbox, scripted per path — and every Authorization it was sent. */
function fakePagbank(options: { refreshStatus?: number; consultOutages?: number; cancelNotYet?: number; sessionStatus?: number } = {}) {
  const seen: { path: string; authorization: string | null; body?: Record<string, unknown> }[] = [];
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
    if (route === 'POST /checkout-sdk/sessions') {
      if (options.sessionStatus) return json({ error_messages: [{ code: 'UNAUTHORIZED' }] }, options.sessionStatus, 'Unauthorized');
      return json({ session: '3ds-session-1', expires_at: 1_800_000_000_000 });
    }
    const debitOrder = debitAnswer(route, body) ?? walletAnswer(route, body);
    if (debitOrder) return debitOrder;
    // The charge form (FUT-3928): the QR rides the WAITING charge.
    const pixCharges = body['charges'] as { payment_method?: { type?: string } }[] | undefined;
    if (route === 'POST /orders' && pixCharges?.[0]?.payment_method?.type === 'PIX') {
      const pix = { type: 'PIX', pix: { expiration_date: '2026-10-17T12:15:00-03:00' } };
      const waiting = { id: 'CHAR_PIX', status: 'WAITING', amount: { value: 1000, currency: 'BRL' }, payment_method: pix, qr_code: { id: 'QRCO_1', text: '00020101pix' } };
      return json({ id: 'ORDE_PIX', reference_id: body['reference_id'], charges: [waiting] }, 201, 'Created');
    }
    if (route === 'GET /orders/ORDE_PIX') {
      pixPolls.push(1);
      const status = pixPolls.length > 1 ? 'PAID' : 'WAITING';
      return json({ id: 'ORDE_PIX', reference_id: 'r', charges: [{ id: 'CHAR_PIX', status, amount: { value: 1000 } }] });
    }
    // The production Pix refund (FUT-4198): a paid Pix canceled.
    if (route === 'POST /charges/CHAR_PIX/cancel') {
      return json({ id: 'CHAR_PIX', status: 'CANCELED', amount: { value: 100, summary: { refunded: 100 } } }, 201, 'Created');
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
      // `seen` already holds this call: the first N consults are the outage.
      if (seen.filter((call) => call.path === route).length <= (options.consultOutages ?? 0)) {
        return json({ error_messages: [{ code: 'SERVICE_UNAVAILABLE' }] }, 503, 'Service Unavailable');
      }
      return json({ id: 'ORDE_C1', charges: [{ id: 'CHAR_OK', status: 'PAID', amount: { value: 1500 } }] });
    }
    if (route === 'GET /charges/CHAR_OK') return json({ id: 'CHAR_OK', status: 'PAID', amount: { value: 1500 } });
    if (route === 'POST /charges/CHAR_OK/cancel') {
      // `seen` already holds this call: the first N cancels are PagBank's "not yet".
      if (seen.filter((call) => call.path === route).length <= (options.cancelNotYet ?? 0)) {
        return json({ error_messages: [{ code: '40008', error: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] }, 400, 'Bad Request');
      }
      return json({ id: 'CHAR_OK', status: 'CANCELED', amount: { value: 1500, summary: { refunded: 1500 } } }, 201, 'Created');
    }
    return json({ error: `unscripted ${route}` }, 404, 'Not Found');
  };
  return { handler, seen };
}

export function world(
  options: {
    refreshStatus?: number;
    consultOutages?: number;
    cancelNotYet?: number;
    sessionStatus?: number;
    sellerEnvironment?: 'SANDBOX' | 'PRODUCTION';
    applePayConfigured?: boolean;
    /** The evidence's own environment (FUT-4198). SANDBOX when absent. */
    environment?: 'SANDBOX' | 'PRODUCTION';
  } = {},
) {
  const environment = options.environment ?? 'SANDBOX';
  const pagbank = fakePagbank(options);
  vi.stubGlobal('fetch', vi.fn(pagbank.handler));
  const providers = defineProviders({ pagbank: pagbankProvider(PT_BR_PAGBANK_COPY) });
  const configs = createMemoryProviderConfigStore();
  const appCreds = (_provider: string, env: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX') => ({
    environment: env,
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
    environment,
    webhookUrl: 'https://example.test/api/webhooks/platform-homologacao/pagbank',
  };
  const runDeps = {
    merchant: SELLER,
    environment,
    store,
    copy: copy.outcome,
    newId,
    gateway,
    oauth,
    seller: async () => {
      const stored = await configs.get(SELLER, 'pagbank');
      if (!stored) return null;
      const fields = stored.environments[stored.environment];
      return {
        environment: options.sellerEnvironment ?? stored.environment,
        token: fields?.['token'] ?? null,
        accountId: fields?.['accountId'] ?? null,
      };
    },
    platformToken: async () => 'platform-account-token',
    consultApplication: () =>
      consultConnectApplication(
        { appCredentials: appCreds, expectedRedirectUri: 'https://example.test/cb', copy: PT_BR_CONNECT_APPLICATION_COPY },
        environment,
      ),
    customer:
      environment === 'PRODUCTION'
        ? { name: BUYER.name, email: BUYER.email, taxId: BUYER.taxId, phone: BUYER.phone }
        : { name: 'Jose da Silva', email: 'cliente@sandbox.pagseguro.com.br', taxId: '12345678909' },
    sleep: async () => undefined,
    pixPolls: 3,
    ...(options.applePayConfigured === undefined ? {} : { applePayConfigured: () => options.applePayConfigured === true }),
  };
  const events: EvidenceWebhookEvent[] = [];
  const fileDeps = {
    store,
    copy,
    environment,
    identification: { name: 'Paladira', site: 'https://paladira.com', clientId: 'cid', callbackUrl: 'https://example.test/cb' },
    webhookEvents: async (wanted: readonly string[]) =>
      events.filter((event) => wanted.some((id) => JSON.stringify(event.payload).includes(id))),
    chargeRow: async () => ({ providerChargeId: 'CHAR_PIX', status: 'PAID', updatedAt: new Date('2026-10-17T15:00:02Z') }),
  };
  return { pagbank, configs, connectDeps, runDeps, fileDeps, events };
}

/** A real cardholder, as the production screen sends it (FUT-4198). */
export const BUYER = {
  name: 'Thompson Moreira Filgueiras',
  email: 'thom@paladira.com',
  taxId: '46556477000159',
  phone: '+5531994494408',
  billingAddress: {
    street: 'Rua Padre Pedro Pinto',
    number: '424',
    complement: 'sala 601',
    regionCode: 'MG',
    city: 'Belo Horizonte',
    postalCode: '31610000',
  },
};

export function cards(): BrowserCardResult[] {
  return [
    { scenario: 'approved', brand: 'VISA', masked: '4539 62** **** 2097', encrypted: 'enc-approved-blob' },
    { scenario: 'declined', brand: 'VISA', masked: '4929 29** **** 0766', encrypted: 'enc-declined-blob' },
    {
      scenario: 'debit',
      brand: 'VISA',
      masked: '4000 00** **** 2701',
      encrypted: 'enc-debit-blob',
      authenticationId: '3DS_AUTH_1',
      authenticated: true,
    },
  ];
}

export async function connected(w: ReturnType<typeof world>) {
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

/** Both wallets' sheets, as a browser that pressed both buttons reports them (FUT-3755). */
export function wallets(): BrowserWalletResult[] {
  return [
    { type: 'GOOGLE_PAY', token: 'gpay-token-secret', brand: 'VISA', last4: '1111' },
    { type: 'APPLE_PAY', token: 'apay-payment-data-secret', brand: 'Visa', last4: '4242' },
  ];
}
