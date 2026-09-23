import { UnsupportedOperationError, ProviderRequestError } from '../core/errors';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { PaymentProviderAdapter } from '../core/provider';
import {
  resolvePaymentsCopy,
  type PaymentsCopySource,
} from '../copy-source';
import type {
  ChargeInput,
  ChargeSnapshot,
  NormalizedWebhookEvent,
  ProbeOutcome,
  RefundInput,
  RefundSnapshot,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import type { ItauCopy } from './copy';
import { providerFetch } from './http';
import { chargeDescription, secureEquals, sha256Hex, stubChargeId, stubCharge, stubPendingSnapshot, stubRefund } from './shared';

/**
 * Itaú adapter — the bank's own Pix Recebimentos API (e.Rede), PIX only.
 *
 * **No card, deliberately.** Itaú's card acquiring is a SEPARATE product
 * (Rede/e.Rede's card API), commercially and technically distinct from Pix
 * Recebimentos; this adapter speaks only the latter. A store that also wants
 * card is expected to enable a second, card-capable provider beside this one
 * (`infinitepay`) — the checkout's own method-routing decides which method
 * goes to which provider, this adapter never sees a `CARD` charge.
 *
 * **`authMode: 'credentials'`.** Itaú's Pix Recebimentos access is a
 * `client_credentials` OAuth2 grant over mTLS: the merchant generates a
 * certificate and a client id/secret in the bank's developer portal ahead of
 * any integration existing to redirect them through, so there is no
 * "authorize" screen to build — the store pastes what the portal handed it,
 * the same shape Stone's key-paste path takes.
 *
 * **Webhook is UNSIGNED.** Itaú's Pix webhook carries no HMAC — unlike
 * PagBank/Stripe/Stone, it is not proof of origin by itself. `verify` checks a
 * shared secret this adapter asks the host to put on the registered webhook
 * URL as a header (the same shape `sharedSecretWebhook` gives every other
 * unsigned provider in this package), which is why a secret field is part of
 * this adapter's OWN credential schema rather than borrowed from a generic
 * helper: Itaú has no comparable per-merchant secret of its own to reuse.
 */

export const NAME = 'itau';

/** Every request in this adapter goes to exactly this host — see `stone-http.ts`'s identical reasoning against SSRF via a tenant-supplied override. */
const API_BASE = 'https://cdpj.partners.itau.com.br';

/**
 * Itaú's `txid` is 26–35 chars, `[a-zA-Z0-9]` only — a stricter, DIFFERENT
 * shape than the BR Code copy-and-paste subfield (`pix-manual/br-code.ts`'s
 * `sanitizeTxId`, 1–25 chars). The two never share a caller, but the shapes
 * must not be confused for one another: a value valid for one is not always
 * valid for the other.
 */
export function itauTxId(reference: string): string {
  const alnum = reference.replace(/[^a-zA-Z0-9]/g, '');
  if (alnum.length >= 26) return alnum.slice(0, 35);
  // Short host references (most order ids) are padded with a deterministic
  // hash of the ORIGINAL reference, never with zeros: padding with a constant
  // would make every short reference under 26 chars collide on the tail.
  return (alnum + sha256Hex(reference).toUpperCase()).slice(0, 35).padEnd(26, '0');
}

interface AccessToken {
  access_token: string;
}

/** Client-credentials token mint — every live call needs a fresh bearer token; Itaú's tokens are short-lived, so this is not cached across calls. */
async function mintAccessToken(credentials: ResolvedCredentials): Promise<string> {
  const clientId = credentials.fields['clientId'];
  const clientSecret = credentials.fields['clientSecret'];
  if (!clientId || !clientSecret) {
    throw new ProviderRequestError(NAME, 'Itau credentials missing clientId/clientSecret.');
  }
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const token = await providerFetch<AccessToken>(NAME, 'oauth/token', `${API_BASE}/api/oauth/jwt`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return token.access_token;
}

interface ItauCob {
  txid?: string;
  status?: string;
  valor?: { original?: string };
  pixCopiaECola?: string;
  calendario?: { criacao?: string; expiracao?: number };
  pix?: Array<{ endToEndId?: string; valor?: string }>;
}

/** Itaú's cob `status` vocabulary, normalized. */
function statusOf(status: string | undefined): ChargeSnapshot['status'] {
  switch (status) {
    case 'CONCLUIDA':
      return 'PAID';
    case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
    case 'REMOVIDA_PELO_PSP':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function centsFrom(decimal: string | undefined): number | undefined {
  if (!decimal) return undefined;
  const value = Number(decimal);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

function snapshotFromCob(cob: ItauCob, fallbackAmountCents: number): ChargeSnapshot {
  const providerChargeId = cob.txid ?? '';
  const amountCents = centsFrom(cob.valor?.original) ?? fallbackAmountCents;
  const expiresAt =
    cob.calendario?.criacao && cob.calendario.expiracao
      ? new Date(new Date(cob.calendario.criacao).getTime() + cob.calendario.expiracao * 1000).toISOString()
      : undefined;
  return {
    provider: NAME,
    providerChargeId,
    reference: providerChargeId,
    status: statusOf(cob.status),
    amount: { amountCents, currency: 'BRL' },
    method: 'PIX',
    pix: cob.pixCopiaECola ? { qrText: cob.pixCopiaECola, expiresAt } : undefined,
    raw: cob,
  };
}

async function createChargeLive(input: ChargeInput, credentials: ResolvedCredentials, copy: ItauCopy): Promise<ChargeSnapshot> {
  const token = await mintAccessToken(credentials);
  const pixKey = credentials.fields['pixKey'];
  if (!pixKey) throw new ProviderRequestError(NAME, copy.credentialsMissing);
  const txid = itauTxId(input.reference);
  const cob = await providerFetch<ItauCob>(NAME, 'pix/cob', `${API_BASE}/pix/v2/cob/${txid}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      calendario: { expiracao: input.pix?.expiresInSeconds ?? 900 },
      valor: { original: (input.amount.amountCents / 100).toFixed(2) },
      chave: pixKey,
      solicitacaoPagador: chargeDescription(input, 140).length > 0 ? chargeDescription(input, 140) : copy.payer.chargeDescription,
    }),
  });
  return { ...snapshotFromCob(cob, input.amount.amountCents), reference: input.reference };
}

async function getChargeLive(providerChargeId: string, credentials: ResolvedCredentials): Promise<ChargeSnapshot> {
  const token = await mintAccessToken(credentials);
  const cob = await providerFetch<ItauCob>(NAME, 'pix/cob', `${API_BASE}/pix/v2/cob/${providerChargeId}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  return snapshotFromCob(cob, 0);
}

async function refundLive(input: RefundInput, credentials: ResolvedCredentials): Promise<RefundSnapshot> {
  const token = await mintAccessToken(credentials);
  // The devolução endpoint is keyed by the END-TO-END id, which the cob
  // response's own `pix[]` array carries and the host never sees otherwise —
  // so a refund reads the charge back first rather than asking the caller for
  // an id this adapter has never handed out.
  const cob = await providerFetch<ItauCob>(NAME, 'pix/cob', `${API_BASE}/pix/v2/cob/${input.providerChargeId}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const endToEndId = cob.pix?.[0]?.endToEndId;
  if (!endToEndId) {
    throw new ProviderRequestError(NAME, 'Itau charge has no settled Pix to refund yet.', { retriable: false });
  }
  const refundId = `${input.providerChargeId}-r1`;
  const amountCents = input.amount?.amountCents ?? centsFrom(cob.pix?.[0]?.valor) ?? 0;
  await providerFetch(NAME, 'pix/devolucao', `${API_BASE}/pix/v2/pix/${endToEndId}/devolucao/${refundId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valor: (amountCents / 100).toFixed(2) }),
  });
  return {
    provider: NAME,
    providerChargeId: input.providerChargeId,
    providerRefundId: refundId,
    status: 'REFUNDED',
    amount: { amountCents, currency: 'BRL' },
  };
}

interface ItauWebhookBody {
  pix?: Array<{ endToEndId?: string; txid?: string; valor?: string; horario?: string }>;
}

/** Every entry becomes its own `CHARGE_UPDATED` — Itaú may batch several Pix into one delivery. */
function parseItauWebhook(delivery: WebhookDelivery): NormalizedWebhookEvent[] {
  let body: ItauWebhookBody;
  try {
    body = JSON.parse(delivery.rawBody) as ItauWebhookBody;
  } catch (cause) {
    throw new ProviderRequestError(NAME, 'Itau webhook body is not valid JSON.', { retriable: false, cause });
  }
  const entries = body.pix ?? [];
  if (entries.length === 0) {
    return [{ provider: NAME, eventId: sha256Hex(delivery.rawBody), type: 'UNKNOWN', raw: body }];
  }
  return entries.map((entry) => ({
    provider: NAME,
    eventId: entry.endToEndId ?? sha256Hex(JSON.stringify(entry)),
    type: 'CHARGE_UPDATED' as const,
    charge: {
      provider: NAME,
      providerChargeId: entry.txid ?? '',
      reference: entry.txid,
      status: 'PAID',
      amount: { amountCents: centsFrom(entry.valor) ?? 0, currency: 'BRL' },
      method: 'PIX',
      raw: entry,
    },
    raw: entry,
  }));
}

/** The txid a real delivery names — read the same way for every entry the batch might carry, but only the first is needed to correlate the ONE `createCharge` reference a reconciliation walk is asking about. */
function itauDeliveryReference(payload: string): string | null {
  try {
    const body = JSON.parse(payload) as ItauWebhookBody;
    return body.pix?.[0]?.txid ?? null;
  } catch {
    return null;
  }
}

export function itauProvider(source: PaymentsCopySource<ItauCopy>): PaymentProviderAdapter {
  const copy = (locale?: string): ItauCopy => resolvePaymentsCopy(source, locale);

  return {
    name: NAME,
    displayName: 'Itau',
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX'],
      savedCards: false,
      refunds: true,
      partialRefunds: true,
      splits: false,
      webhooks: true,
      tokenization: 'NONE',
      activationCharge: true,
    },
    credentialSchema: ({ locale }) => {
      const { fields } = copy(locale ?? undefined);
      return [
        { key: 'clientId', label: fields.clientId, secret: false, required: true },
        { key: 'clientSecret', label: fields.clientSecret, secret: true, required: true },
        { key: 'certificate', label: fields.certificate, secret: true, required: true },
        { key: 'pixKey', label: fields.pixKey, secret: false, required: true },
        { key: 'webhookSecret', label: fields.webhookSecret, secret: true, required: true },
      ];
    },
    customerSchema: [
      { key: 'name', type: 'NAME', required: false },
      { key: 'taxId', type: 'CPF', required: false },
    ],

    async verifyCredentials(credentials, locale): Promise<ProbeOutcome> {
      if (credentials.stub) return { ok: true, message: 'stub mode' };
      try {
        await mintAccessToken(credentials);
        return { ok: true };
      } catch (error) {
        const c = copy(locale);
        if (error instanceof ProviderRequestError && (error.options.httpStatus === 401 || error.options.httpStatus === 403)) {
          return { ok: false, message: c.refused, fault: 'REFUSED' };
        }
        return { ok: false, message: c.unreachable, fault: 'UNREACHABLE' };
      }
    },

    async createCharge(input, credentials) {
      if (input.method !== 'PIX') throw new UnsupportedOperationError(NAME, `createCharge(${input.method})`);
      if (credentials.stub) return stubCharge(NAME, input, credentials);
      return createChargeLive(input, credentials, copy(input.locale));
    },

    async getCharge(providerChargeId, credentials) {
      if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
      return getChargeLive(providerChargeId, credentials);
    },

    async findChargeByReference(reference, credentials) {
      if (credentials.stub) return stubPendingSnapshot(NAME, stubChargeId(NAME, reference));
      try {
        return await getChargeLive(itauTxId(reference), credentials);
      } catch (error) {
        if (error instanceof ProviderRequestError && error.options.httpStatus === 404) return null;
        throw error;
      }
    },

    async refund(input, credentials) {
      if (credentials.stub) return stubRefund(NAME, input);
      return refundLive(input, credentials);
    },

    webhook: {
      async verify(delivery, credentials) {
        const secret = credentials.fields['webhookSecret'];
        if (!secret) return stubDeliveryTrusted(credentials);
        const presented = delivery.headers['x-webhook-secret'] ?? '';
        return secureEquals(presented, secret);
      },
      async parse(delivery) {
        return parseItauWebhook(delivery);
      },
    },
    // Itaú's Pix webhook fires ONLY when the SPI confirms a received payment —
    // there is no other event family on this endpoint — so a verified,
    // processed delivery is durable proof money moved, and the txid it names
    // is the same reference `createCharge` sent.
    verifyConfirmsPayment: true,
    referenceOfDelivery: itauDeliveryReference,

    clientConfig() {
      return { provider: NAME, tokenization: 'NONE' };
    },
  };
}
