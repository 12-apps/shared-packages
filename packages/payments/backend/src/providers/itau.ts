import { ProviderRequestError, UnsupportedOperationError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { resolvePaymentsCopy, type PaymentsCopySource } from '../copy-source';
import type {
  ChargeInput,
  ChargeSnapshot,
  CredentialFieldSpec,
  ProbeOutcome,
  RefundInput,
  RefundSnapshot,
  ResolvedCredentials,
} from '../core/types';
import type { ItauCopy } from './copy';
import { ItauTokenError, itauSession, itauSetupProblem, NAME, readCob, type ItauSetupProblem } from './itau-http';
import {
  committedRefundCents,
  centsFrom,
  decimalFrom,
  devedorOf,
  devolucaoId,
  itauTxId,
  refundSnapshotOf,
  snapshotFromCob,
  type ItauCob,
  type ItauDevolucao,
} from './itau-pix';
import { itauSetupGuide } from './itau-setup-guide';
import { parseItauWebhook, verifyItauWebhook } from './itau-webhook';
import { unreachableOutcome } from './probe-shared';
import { chargeDescription, stubCharge, stubPendingSnapshot, stubRefund } from './shared';

export { itauTxId } from './itau-pix';
export { NAME } from './itau-http';

/**
 * Itaú adapter — the bank's own Pix Recebimentos API (BACEN "API Pix"), PIX
 * only.
 *
 * **No card, deliberately.** Itaú's card acquiring is Rede, a SEPARATE
 * product, commercially and technically distinct from Pix Recebimentos. A
 * store that also wants card enables a card-capable provider beside this one
 * (`infinitepay`); the charge walk's capability gate skips this adapter for a
 * `CARD` charge (`core/charge-attempt.ts`), so it never sees one.
 *
 * **`authMode: 'credentials'` over mTLS.** Access is a `client_credentials`
 * grant, and in production EVERY call — the token mint included — must
 * present the merchant's own client certificate (`mtls.ts`). The merchant
 * generates certificate and client id/secret in Itaú's developer portal
 * before any integration exists to redirect them through, so there is no
 * "authorize" screen — the store pastes what the portal handed it.
 *
 * **Webhook authenticated by re-asking Itaú** — see `itau-webhook.ts`. It
 * declares no `verifyConfirmsPayment`: a delivery names only the `txid`, a
 * one-way digest of the host reference (`itauTxId`), so no reader can say
 * which reference a stored delivery proves, and FUT-726 forbids the flag
 * without one.
 *
 * **No `activationCharge`.** The only activation proof a non-redirect adapter
 * can produce today is the CARD flow (`activation/flow.ts`), and this adapter
 * takes no card — declaring the flag would lock the enable switch behind a
 * proof it can never produce. The credential probe (a real token mint, over
 * mTLS in production) is what vouches for the connection.
 */

/** A buyer has this long to pay when the host asks for no expiry — the same default Stone's PIX takes. */
const DEFAULT_EXPIRY_SECONDS = 900;

/** BACEN caps `solicitacaoPagador` at 140 characters. */
const PAYER_LINE_MAX = 140;

async function createChargeLive(input: ChargeInput, credentials: ResolvedCredentials, copy: ItauCopy): Promise<ChargeSnapshot> {
  const call = await itauSession(credentials);
  const description = chargeDescription(input, PAYER_LINE_MAX);
  const devedor = devedorOf(input);
  const txid = itauTxId(input.reference);
  const cob = await call<ItauCob>('pix/cob', `/cob/${txid}`, {
    method: 'PUT',
    json: {
      calendario: { expiracao: input.pix?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
      ...(devedor ? { devedor } : {}),
      valor: { original: decimalFrom(input.amount.amountCents) },
      chave: credentials.fields['pixKey'],
      solicitacaoPagador: description.length > 0 ? description : copy.payer.chargeDescription,
    },
  });
  // What we asked for stands wherever the answer is silent: a charge keyed by
  // an empty id would collide in the charge store, and a 0 would read as
  // "nothing to pay".
  return snapshotFromCob({ txid, valor: { original: decimalFrom(input.amount.amountCents) }, ...cob }, input.reference);
}

async function getChargeLive(txid: string, credentials: ResolvedCredentials, reference?: string): Promise<ChargeSnapshot> {
  return snapshotFromCob(await readCob(await itauSession(credentials), txid), reference);
}

/**
 * A devolução is keyed by the Pix's END-TO-END id, which only the cob's own
 * `pix[]` carries — so a refund reads the charge back first rather than ask
 * the caller for an id this adapter never handed out. A full refund returns
 * what is still refundable (earlier partial devoluções excluded), and the
 * answer is Itaú's own status: a devolução is asynchronous, usually
 * `EM_PROCESSAMENTO` (PENDING) first, and settles over the webhook.
 */
async function refundLive(input: RefundInput, credentials: ResolvedCredentials): Promise<RefundSnapshot> {
  const call = await itauSession(credentials);
  const plan = refundPlan(await readCob(call, input.providerChargeId), input);
  const devolucao = await call<ItauDevolucao>(
    'pix/devolucao',
    `/pix/${encodeURIComponent(plan.endToEndId)}/devolucao/${plan.id}`,
    { method: 'PUT', json: { valor: decimalFrom(plan.amountCents) } },
  );
  return refundSnapshotOf(input.providerChargeId, { id: plan.id, ...devolucao }, plan.amountCents);
}

/** What to send back and under which id — refused locally when nothing (or not that much) is left. */
function refundPlan(cob: ItauCob, input: RefundInput): { endToEndId: string; id: string; amountCents: number } {
  const pix = cob.pix?.[0];
  if (!pix?.endToEndId) {
    throw new ProviderRequestError(NAME, 'Itau charge has no received Pix to refund yet.', { retriable: false });
  }
  const refundable = (centsFrom(pix.valor) ?? 0) - committedRefundCents(pix);
  const amountCents = input.amount?.amountCents ?? refundable;
  assertRefundable(amountCents, refundable);
  return { endToEndId: pix.endToEndId, id: devolucaoId(pix.endToEndId, pix.devolucoes?.length ?? 0), amountCents };
}

function assertRefundable(amountCents: number, refundable: number): void {
  if (amountCents > 0 && amountCents <= refundable) return;
  throw new ProviderRequestError(NAME, `Itau refund of ${amountCents} exceeds the ${refundable} still refundable.`, {
    retriable: false,
  });
}

function itauCredentialSchema(fields: ItauCopy['fields']): CredentialFieldSpec[] {
  return [
    { key: 'clientId', label: fields.clientId, secret: false, required: true },
    { key: 'clientSecret', label: fields.clientSecret, secret: true, required: true },
    // Production-only (the sandbox has no mTLS), so not `required`: a
    // production store missing either is refused by `verifyCredentials`.
    { key: 'certificate', label: fields.certificate, secret: true, required: false, multiline: true, helperText: fields.productionOnly },
    { key: 'privateKey', label: fields.privateKey, secret: true, required: false, multiline: true, helperText: fields.productionOnly },
    { key: 'pixKey', label: fields.pixKey, secret: false, required: true, mono: true, confirmOnSave: true },
  ];
}

const SETUP_COPY: Record<ItauSetupProblem, keyof ItauCopy> = {
  MISSING: 'credentialsMissing',
  CERTIFICATE_MISSING: 'certificateMissing',
  CERTIFICATE_INVALID: 'certificateInvalid',
  CERTIFICATE_MISMATCH: 'certificateMismatch',
  CERTIFICATE_EXPIRED: 'certificateExpired',
  CERTIFICATE_NOT_YET_VALID: 'certificateNotYetValid',
};

function setupMessage(problem: ItauSetupProblem, copy: ItauCopy): string {
  return copy[SETUP_COPY[problem]] as string;
}

/** Statuses that mean "try again later", not "these credentials are wrong". */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);

function codeOf(error: unknown): string | undefined {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  for (const candidate of [cause, error]) {
    if (candidate && typeof candidate === 'object' && 'code' in candidate) {
      const code = (candidate as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return undefined;
}

/**
 * A handshake that died after we presented a client certificate: Itaú refuses
 * an untrusted, revoked or wrong-environment certificate by resetting the
 * connection, so Node never sees a status. Read as REFUSED with the
 * certificate named — "unreachable" there sends the owner to retry forever.
 * Server-certificate codes (`CERT_HAS_EXPIRED`, …) are about Itaú's side and
 * stay transport failures.
 */
function certificateRefused(error: ItauTokenError): boolean {
  if (!error.detail.mtls || error.detail.httpStatus !== undefined) return false;
  const code = codeOf(error.detail.cause) ?? '';
  return code === 'ECONNRESET' || code.startsWith('ERR_SSL_');
}

function tokenOutcome(error: ItauTokenError, copy: ItauCopy): ProbeOutcome | null {
  const status = error.detail.httpStatus;
  if (certificateRefused(error)) return { ok: false, fault: 'REFUSED', message: copy.certificateRefused };
  if (status === undefined) return unreachableOutcome(error.detail.cause, copy.unreachable);
  if (status >= 500 || TRANSIENT_STATUSES.has(status) || status < 400) {
    return { ok: false, fault: 'UNREACHABLE', message: copy.unreachable };
  }
  return { ok: false, fault: 'REFUSED', message: copy.refused };
}

/**
 * The probe: local checks first (a truncated or lapsed certificate is a
 * credential problem, not an outage), then a real token mint — which in
 * production exercises the certificate, the key AND the client id/secret in
 * one call. Anything it cannot positively read as a refusal or a transport
 * failure is rethrown rather than dressed up as "unreachable"
 * (`probe-shared.ts`): a bug must not look like Itaú being down.
 */
async function verifyItauCredentials(credentials: ResolvedCredentials, copy: ItauCopy): Promise<ProbeOutcome> {
  if (credentials.stub) return { ok: true, message: 'stub mode' };
  const problem = itauSetupProblem(credentials);
  if (problem) return { ok: false, fault: 'REFUSED', message: setupMessage(problem, copy) };
  try {
    await itauSession(credentials);
    return { ok: true };
  } catch (error) {
    const outcome = error instanceof ItauTokenError ? tokenOutcome(error, copy) : null;
    if (outcome) return outcome;
    throw error;
  }
}

async function findChargeByReference(reference: string, credentials: ResolvedCredentials): Promise<ChargeSnapshot | null> {
  // Stub mode has no memory of what it raised, so it finds nothing — the same
  // answer Stone and PagBank give, and the one a scripted failover needs.
  if (credentials.stub) return null;
  try {
    return await getChargeLive(itauTxId(reference), credentials, reference);
  } catch (error) {
    if (error instanceof ProviderRequestError && error.options.httpStatus === 404) return null;
    throw error;
  }
}

export function itauProvider(source: PaymentsCopySource<ItauCopy>): PaymentProviderAdapter {
  const copy = (locale?: string): ItauCopy => resolvePaymentsCopy(source, locale);

  return {
    name: NAME,
    // From the copy pack, where the accent may live (shipped source is ASCII).
    displayName: copy().displayName,
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX'],
      savedCards: false,
      refunds: true,
      partialRefunds: true,
      splits: false,
      webhooks: true,
      tokenization: 'NONE',
    },
    credentialSchema: ({ locale }) => itauCredentialSchema(copy(locale ?? undefined).fields),
    customerSchema: [
      { key: 'name', type: 'NAME', required: false },
      { key: 'taxId', type: 'CPF', required: false },
    ],

    verifyCredentials: (credentials, locale) => verifyItauCredentials(credentials, copy(locale ?? undefined)),

    async createCharge(input, credentials) {
      if (input.method !== 'PIX') throw new UnsupportedOperationError(NAME, `createCharge(${input.method})`);
      if (credentials.stub) return stubCharge(NAME, input, credentials);
      return createChargeLive(input, credentials, copy(input.locale));
    },

    async getCharge(providerChargeId, credentials) {
      if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
      return getChargeLive(providerChargeId, credentials);
    },

    findChargeByReference,

    async refund(input, credentials) {
      if (credentials.stub) return stubRefund(NAME, input);
      return refundLive(input, credentials);
    },

    webhook: {
      verify: verifyItauWebhook,
      parse: parseItauWebhook,
    },

    setupGuide: (ctx) => itauSetupGuide(copy(ctx.locale).setupGuide, ctx),

    clientConfig() {
      return { provider: NAME, tokenization: 'NONE' };
    },
  };
}
