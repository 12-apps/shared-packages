import { isValidCpf } from '../core/cpf';
import type { ChargeInput, ChargeSnapshot, RefundSnapshot } from '../core/types';
import { NAME } from './itau-http';
import { sha256Hex } from './shared';

/**
 * Itaú's Pix vocabulary — the BACEN "API Pix" shapes its Pix Recebimentos
 * API speaks — and every mapping out of it. Pure: no I/O, so each rule here
 * is testable without a transport.
 */

export interface ItauDevolucao {
  id?: string;
  rtrId?: string;
  valor?: string;
  /** `EM_PROCESSAMENTO` | `DEVOLVIDO` | `NAO_REALIZADO`. */
  status?: string;
}

export interface ItauPix {
  endToEndId?: string;
  txid?: string;
  valor?: string;
  horario?: string;
  devolucoes?: ItauDevolucao[];
}

export interface ItauCob {
  txid?: string;
  status?: string;
  valor?: { original?: string };
  pixCopiaECola?: string;
  calendario?: { criacao?: string; expiracao?: number };
  pix?: ItauPix[];
}

/**
 * Itaú's `txid` is 26–35 chars, `[a-zA-Z0-9]` only — a stricter, DIFFERENT
 * shape than the BR Code copy-and-paste subfield (`pix-manual/br-code.ts`'s
 * `sanitizeTxId`, 1–25 chars). Deterministic, so `findChargeByReference` can
 * re-derive the txid a charge was raised under from the reference alone.
 *
 * A short readable prefix (so the bank's dashboard still hints at the order)
 * plus a hash of the WHOLE reference — never a truncation of it. The repo's
 * attempt convention appends `--<attempt>` (`core/reference.ts`), so a
 * truncation cuts exactly the part that makes a retry distinct and hands it
 * the previous attempt's cob; punctuation-only differences would collide too.
 * The hash is also why a delivery's txid cannot be turned back into the
 * reference, and why this adapter declares no `referenceOfDelivery`.
 */
const TXID_PREFIX = 9;
const TXID_HASH = 26;

export function itauTxId(reference: string): string {
  const readable = reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, TXID_PREFIX);
  return `${readable}${sha256Hex(reference).slice(0, TXID_HASH)}`;
}

/** A BACEN decimal string (`"12.50"`) in integer cents; undefined when absent or malformed. */
export function centsFrom(decimal: string | undefined): number | undefined {
  if (!decimal || !/^\d+(\.\d{1,2})?$/.test(decimal)) return undefined;
  const [units = '0', fraction = ''] = decimal.split('.');
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Integer cents as the two-decimal string every BACEN amount field takes. */
export function decimalFrom(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError(`not a whole, non-negative cent amount: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function refundStatusOf(status: string | undefined): RefundSnapshot['status'] {
  if (status === 'DEVOLVIDO') return 'REFUNDED';
  if (status === 'NAO_REALIZADO') return 'FAILED';
  return 'PENDING';
}

/** Cents already returned (or on their way back) from one received Pix — failed devoluções excluded. */
export function committedRefundCents(pix: ItauPix): number {
  return (pix.devolucoes ?? [])
    .filter((devolucao) => refundStatusOf(devolucao.status) !== 'FAILED')
    .reduce((sum, devolucao) => sum + (centsFrom(devolucao.valor) ?? 0), 0);
}

function settledRefundCents(pix: ItauPix): number {
  return (pix.devolucoes ?? [])
    .filter((devolucao) => refundStatusOf(devolucao.status) === 'REFUNDED')
    .reduce((sum, devolucao) => sum + (centsFrom(devolucao.valor) ?? 0), 0);
}

/**
 * The cob's `status`, normalized — refund-aware, because a CONCLUIDA cob
 * stays CONCLUIDA after its money goes back; only the Pix's own `devolucoes`
 * say so. An ATIVA cob stays PENDING even past its expiry: status only moves
 * forward (`core/status.ts`), so an EXPIRED guessed from a skewed clock would
 * shut out a payment that landed in the last second.
 */
function chargeStatusOf(cob: ItauCob): ChargeSnapshot['status'] {
  switch (cob.status) {
    case 'CONCLUIDA':
      return concludedStatusOf(cob.pix?.[0]);
    case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
    case 'REMOVIDA_PELO_PSP':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function concludedStatusOf(pix: ItauPix | undefined): ChargeSnapshot['status'] {
  if (!pix) return 'PAID';
  const refunded = settledRefundCents(pix);
  if (refunded === 0) return 'PAID';
  return refunded >= (centsFrom(pix.valor) ?? 0) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

function expiresAtOf(cob: ItauCob): string | undefined {
  const { criacao, expiracao } = cob.calendario ?? {};
  const createdMs = criacao ? new Date(criacao).getTime() : Number.NaN;
  if (!expiracao || Number.isNaN(createdMs)) return undefined;
  return new Date(createdMs + expiracao * 1000).toISOString();
}

/**
 * The normalized charge behind a cob. The amount is what SETTLED when a Pix
 * landed (the shortfall guard reads the money that moved, FUT-373), else what
 * was asked; a reported 0 is silence the snapshot merge already ignores.
 */
export function snapshotFromCob(cob: ItauCob, reference?: string): ChargeSnapshot {
  const amountCents = centsFrom(cob.pix?.[0]?.valor) ?? centsFrom(cob.valor?.original) ?? 0;
  return {
    provider: NAME,
    providerChargeId: cob.txid ?? '',
    ...(reference ? { reference } : {}),
    status: chargeStatusOf(cob),
    amount: { amountCents, currency: 'BRL' },
    method: 'PIX',
    pix: cob.pixCopiaECola ? { qrText: cob.pixCopiaECola, expiresAt: expiresAtOf(cob) } : undefined,
    raw: cob,
  };
}

/** BACEN caps `devedor.nome` at 200 characters. */
const DEVEDOR_NAME_MAX = 200;

/**
 * The payer, when the buyer gave both halves BACEN requires together — a
 * name alone or a document alone is refused as a malformed `devedor`.
 */
export function devedorOf(input: ChargeInput): Record<string, string> | undefined {
  const nome = input.customer.name?.trim().slice(0, DEVEDOR_NAME_MAX);
  const document = input.customer.taxId?.replace(/\D/g, '') ?? '';
  if (!nome) return undefined;
  // A CPF that fails its own check digits is left out rather than sent: Itau
  // refuses the whole cob for a malformed devedor, and the buyer would lose
  // the charge over a field nobody required.
  if (document.length === 11) return isValidCpf(document) ? { cpf: document, nome } : undefined;
  if (document.length === 14) return { cnpj: document, nome };
  return undefined;
}

/**
 * A devolução id: BACEN demands `[a-zA-Z0-9]{1,35}` and that it identify ONE
 * devolução. Derived from the Pix's end-to-end id plus the count of
 * devoluções it already carries, so every partial refund gets its own id
 * while a transport-level retry of the same request (which never landed)
 * re-sends the same one and Itaú's PUT stays idempotent.
 */
export function devolucaoId(endToEndId: string, existing: number): string {
  return `D${sha256Hex(endToEndId).slice(0, 30)}${String(existing + 1).padStart(4, '0')}`;
}

/** A devolução Itaú answered with, normalized. */
export function refundSnapshotOf(
  providerChargeId: string,
  devolucao: ItauDevolucao,
  fallbackCents: number,
): RefundSnapshot {
  return {
    provider: NAME,
    providerChargeId,
    providerRefundId: devolucao.id ?? '',
    status: refundStatusOf(devolucao.status),
    amount: { amountCents: centsFrom(devolucao.valor) ?? fallbackCents, currency: 'BRL' },
    raw: devolucao,
  };
}
