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
import { itauSession, itauSetupProblem, NAME, readCob, type ItauSetupProblem } from './itau-http';
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
import { parseItauWebhook, verifyItauWebhook } from './itau-webhook';
import { unreachableOutcome } from './probe-shared';
import { chargeDescription, stubChargeId, stubCharge, stubPendingSnapshot, stubRefund } from './shared';

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
 * without one. An activation still settles through `findChargeByReference`,
 * which re-derives the txid.
 */

/** A buyer has this long to pay when the host asks for no expiry — the same default Stone's PIX takes. */
const DEFAULT_EXPIRY_SECONDS = 900;

/** BACEN caps `solicitacaoPagador` at 140 characters. */
const PAYER_LINE_MAX = 140;

async function createChargeLive(input: ChargeInput, credentials: ResolvedCredentials, copy: ItauCopy): Promise<ChargeSnapshot> {
  const call = await itauSession(credentials);
  const description = chargeDescription(input, PAYER_LINE_MAX);
  const devedor = devedorOf(input);
  const cob = await call<ItauCob>('pix/cob', `/cob/${itauTxId(input.reference)}`, {
    method: 'PUT',
    json: {
      calendario: { expiracao: input.pix?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS },
      ...(devedor ? { devedor } : {}),
      valor: { original: decimalFrom(input.amount.amountCents) },
      chave: credentials.fields['pixKey'],
      solicitacaoPagador: description.length > 0 ? description : copy.payer.chargeDescription,
    },
  });
  return snapshotFromCob(cob, input.reference);
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
    { key: 'certificate', label: fields.certificate, secret: true, required: false, helperText: fields.productionOnly },
    { key: 'privateKey', label: fields.privateKey, secret: true, required: false, helperText: fields.productionOnly },
    { key: 'pixKey', label: fields.pixKey, secret: false, required: true, mono: true, confirmOnSave: true },
  ];
}

function setupMessage(problem: ItauSetupProblem, copy: ItauCopy): string {
  switch (problem) {
    case 'MISSING':
      return copy.credentialsMissing;
    case 'CERTIFICATE_MISSING':
      return copy.certificateMissing;
    case 'CERTIFICATE_INVALID':
      return copy.certificateInvalid;
    case 'CERTIFICATE_MISMATCH':
      return copy.certificateMismatch;
  }
}

/**
 * The probe: local checks first (a truncated PEM is a credential problem,
 * not an outage), then a real token mint — which in production exercises
 * the certificate, the key AND the client id/secret in one call.
 */
async function verifyItauCredentials(credentials: ResolvedCredentials, copy: ItauCopy): Promise<ProbeOutcome> {
  if (credentials.stub) return { ok: true, message: 'stub mode' };
  const problem = itauSetupProblem(credentials);
  if (problem) return { ok: false, fault: 'REFUSED', message: setupMessage(problem, copy) };
  try {
    await itauSession(credentials);
    return { ok: true };
  } catch (error) {
    const unreachable = unreachableOutcome(error, copy.unreachable);
    if (unreachable) return unreachable;
    const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return { ok: false, fault: 'REFUSED', message: copy.refused };
    }
    return { ok: false, fault: 'UNREACHABLE', message: copy.unreachable };
  }
}

async function findChargeByReference(reference: string, credentials: ResolvedCredentials): Promise<ChargeSnapshot | null> {
  if (credentials.stub) return stubPendingSnapshot(NAME, stubChargeId(NAME, reference));
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

    clientConfig() {
      return { provider: NAME, tokenization: 'NONE' };
    },
  };
}
