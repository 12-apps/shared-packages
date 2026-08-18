/**
 * Homologação "Anexo" generator (FUT-483, packaged by FUT-573) — the evidence
 * file PagBank's form requires ("insira os requests e responses das
 * requisições enviadas para as APIs PagBank").
 *
 * The evidence is the PLATFORM's: it runs against the platform's own PagBank
 * SANDBOX credentials, never a tenant's, and captures the three calls the
 * integration is built on — create a PIX order, consult it, mint a card
 * public key — as token-redacted request/response pairs ready for a form
 * upload.
 *
 * Sandbox-only by construction: the base URL is pinned to the sandbox host
 * and the token the host passes must come from its SANDBOX slot, so
 * generating evidence can never charge anything real. Host-agnostic: the
 * token and every deployment fact arrive per call
 * ({@link PlatformHomologacaoAnexoInput}); nothing is read from the
 * environment or a database. Server-only.
 */

import { pagbankApiBase } from '../providers/pagbank-api-base';

/** Sandbox-only by construction — see the header. */
const DEFAULT_SANDBOX_API_BASE = pagbankApiBase('SANDBOX');

/** The generated attachment, ready for a browser download / form upload. */
export interface HomologacaoAnexo {
  filename: string;
  content: string;
}

/**
 * Structured outcome so a host route can answer with a SPECIFIC, actionable
 * message instead of a generic 500:
 * - `NO_SANDBOX_TOKEN` — the platform has no PagBank sandbox token stored.
 * - `TOKEN_REJECTED` — PagBank answered 401/403 (wrong/rotated sandbox token).
 * - `SANDBOX_UNREACHABLE` — network failure talking to the sandbox.
 */
export type HomologacaoAnexoFailure = 'NO_SANDBOX_TOKEN' | 'TOKEN_REJECTED' | 'SANDBOX_UNREACHABLE';

export type HomologacaoAnexoResult =
  | { ok: true; anexo: HomologacaoAnexo }
  | { ok: false; reason: HomologacaoAnexoFailure };

/** Everything the generator needs from the host — credentials arrive per call. */
export interface PlatformHomologacaoAnexoInput {
  /**
   * The platform's own PagBank SANDBOX token — read from the SANDBOX slot
   * whatever environment is active, because the evidence must be produced
   * against sandbox, never a live account. `null` refuses with
   * `NO_SANDBOX_TOKEN` before any network call.
   */
  sandboxToken: string | null;
  /** The name the file's header introduces the platform by. */
  brandName: string;
  /** The deployment's public origin, e.g. `https://app.example.com`. */
  publicBaseUrl: string;
  /** The reviewer-visitable storefront the header points at. */
  demoStoreUrl: string;
  /** Where PagBank delivers webhooks for that storefront (`notification_urls`). */
  webhookUrl: string;
  /** Override the sandbox origin — tests only. */
  sandboxApiBase?: string;
}

interface CapturedCall {
  title: string;
  method: string;
  url: string;
  requestBody?: unknown;
  status: string;
  responseBody: unknown;
}

function renderCall(call: CapturedCall): string {
  return [
    '================================================================',
    call.title,
    '================================================================',
    '',
    'REQUEST',
    `${call.method} ${call.url}`,
    'Authorization: Bearer ***REDACTED***',
    'Content-Type: application/json',
    ...(call.requestBody !== undefined ? ['', JSON.stringify(call.requestBody, null, 2)] : []),
    '',
    'RESPONSE',
    `HTTP ${call.status}`,
    '',
    JSON.stringify(call.responseBody, null, 2),
    '',
  ].join('\n');
}

function renderAnexo(input: PlatformHomologacaoAnexoInput, calls: CapturedCall[]): string {
  const apiBase = input.sandboxApiBase ?? DEFAULT_SANDBOX_API_BASE;
  const header = [
    `ANEXO DE HOMOLOGAÇÃO — ${input.brandName} (plataforma / ${input.publicBaseUrl.replace(/^https:\/\//, '')})`,
    'Integração: Desenvolvimento próprio — API de Pedidos e Pagamentos (Order) e API Connect',
    `Ambiente dos testes: SANDBOX (${apiBase})`,
    'Credenciais: token de SANDBOX da própria plataforma (conta PagBank da plataforma).',
    `Data: ${new Date().toISOString()}`,
    'Token de autenticação redigido por segurança (Bearer ***REDACTED***).',
    '',
    'Fluxo da integração: a plataforma opera lojas multi-tenant; o checkout da',
    `loja de demonstração (${input.demoStoreUrl}) cria o pedido`,
    'com QR Code PIX (1); o cliente paga pelo app do banco; o PagBank envia webhook para',
    input.webhookUrl,
    'e a confirmação é validada consultando o pedido (2) antes de marcar como pago.',
    'A chave pública (3) alimenta a criptografia de cartão no navegador.',
    'Via API Connect (/oauth2/*), cada lojista autoriza a aplicação da plataforma',
    'na própria conta PagBank (authorization_code + refresh), com os tokens',
    'resultantes usados nas mesmas APIs de Pedidos acima.',
    '',
  ].join('\n');
  return header + '\n' + calls.map(renderCall).join('\n');
}

function pathSafeKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 24);
}

async function callSandbox(
  apiBase: string,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: string; json: unknown }> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-idempotency-key': `homolog-${pathSafeKey(path)}-${Date.now()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => ({}));
  return { status: `${res.status} ${res.statusText}`, json };
}

/** 401/403 from the sandbox means the token itself was refused. */
function isAuthRejection(status: string): boolean {
  return status.startsWith('401') || status.startsWith('403');
}

/** The sandbox PIX order the evidence opens with — a real create, nothing charged. */
function pixOrderPayload(webhookUrl: string): Record<string, unknown> {
  return {
    reference_id: `homolog-platform-${Date.now()}`,
    customer: {
      name: 'Cliente Teste Homologacao',
      email: 'cliente@sandbox.pagseguro.com.br',
      tax_id: '12345678909',
    },
    qr_codes: [
      {
        amount: { value: 500 },
        expiration_date: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    ],
    notification_urls: [webhookUrl],
  };
}

/** The consult + public-key pairs that follow a successful create. */
async function captureFollowUps(
  apiBase: string,
  token: string,
  orderId: string | undefined,
): Promise<CapturedCall[]> {
  const calls: CapturedCall[] = [];
  if (orderId) {
    const consulted = await callSandbox(apiBase, token, 'GET', `/orders/${orderId}`);
    calls.push({
      title:
        '2. Consultar pedido — GET /orders/{order_id} (confirmação/reconciliação de pagamento)',
      method: 'GET',
      url: `${apiBase}/orders/${orderId}`,
      status: consulted.status,
      responseBody: consulted.json,
    });
  }
  const publicKey = await callSandbox(apiBase, token, 'POST', '/public-keys', { type: 'card' });
  calls.push({
    title: '3. Chave pública para criptografia de cartão — POST /public-keys',
    method: 'POST',
    url: `${apiBase}/public-keys`,
    requestBody: { type: 'card' },
    status: publicKey.status,
    responseBody: publicKey.json,
  });
  return calls;
}

/** Run the real sandbox calls with the platform's token and assemble the file. */
export async function buildPlatformHomologacaoAnexo(
  input: PlatformHomologacaoAnexoInput,
): Promise<HomologacaoAnexoResult> {
  const token = input.sandboxToken;
  if (!token) return { ok: false, reason: 'NO_SANDBOX_TOKEN' };

  const apiBase = input.sandboxApiBase ?? DEFAULT_SANDBOX_API_BASE;
  const pixPayload = pixOrderPayload(input.webhookUrl);
  const calls: CapturedCall[] = [];
  try {
    const created = await callSandbox(apiBase, token, 'POST', '/orders', pixPayload);
    if (isAuthRejection(created.status)) {
      return { ok: false, reason: 'TOKEN_REJECTED' };
    }
    calls.push({
      title: '1. Criar pedido com QR Code PIX — POST /orders (API de Pedidos e Pagamentos)',
      method: 'POST',
      url: `${apiBase}/orders`,
      requestBody: pixPayload,
      status: created.status,
      responseBody: created.json,
    });
    calls.push(...(await captureFollowUps(apiBase, token, (created.json as { id?: string }).id)));
  } catch {
    // `fetch` throws (TypeError) only on network/DNS failure — no response.
    return { ok: false, reason: 'SANDBOX_UNREACHABLE' };
  }

  return {
    ok: true,
    anexo: {
      filename: 'pagbank-homologacao-anexo-plataforma.txt',
      content: renderAnexo(input, calls),
    },
  };
}
