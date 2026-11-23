import { pagbankDecline } from '../../providers/pagbank-declines';
import { classifyPagBankRejectionBody } from '../../providers/pagbank-rejections';
import type { RecordedHttpCall } from '../../core/traffic-recorder';
import type { EvidenceFailureReason } from './types';

/**
 * Why a charge failed, as a CODE (FUT-4322), read from what PagBank answered:
 * its structured `error_messages` over the recorded calls — never the message
 * text. The failover walk throws one error for the whole chain, so the reason
 * is read from the recorded answers, with the same predicate that reads a
 * provider error (`classifyPagBankRejectionBody`).
 */
export function reasonOfFailedCalls(calls: readonly RecordedHttpCall[]): EvidenceFailureReason | undefined {
  const rejected = calls.some((call) => classifyPagBankRejectionBody(call.responseBody) === 'EMAIL_EQUALS_MERCHANT');
  return rejected ? 'EMAIL_EQUALS_MERCHANT' : undefined;
}

/** The `payment_response.code` of the last recorded answer that carries a charge, if any. */
function declineCodeOf(calls: readonly RecordedHttpCall[]): string | undefined {
  for (const call of [...calls].reverse()) {
    const charges = (call.responseBody as { charges?: unknown } | undefined)?.charges;
    if (!Array.isArray(charges)) continue;
    const code = (charges.at(-1) as { payment_response?: { code?: unknown } } | undefined)?.payment_response?.code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return undefined;
}

/**
 * A charge declined where the scenario expected it paid (FUT-5512): PagBank's
 * own antifraud when its `payment_response.code` is one of PagBank's refusals
 * (the 10xxx block) that `pagbankDecline` reads as `FRAUD_SUSPECTED` — today
 * `10000` "NAO AUTORIZADO PELO PAGSEGURO" —, the issuer otherwise. Sending the
 * operator to the card's bank for PagBank's own refusal sent them to the wrong
 * party (an Apple Pay charge, 2026-11-23).
 */
export function reasonOfStatus(
  status: string,
  expected: string,
  calls: readonly RecordedHttpCall[] = [],
): EvidenceFailureReason | undefined {
  if (status !== 'DECLINED' || expected === 'DECLINED') return undefined;
  const code = declineCodeOf(calls);
  const antifraud = code !== undefined && code.startsWith('10') && pagbankDecline(code).reason === 'FRAUD_SUSPECTED';
  return antifraud ? 'ANTIFRAUD_DECLINED' : 'ISSUER_DECLINED';
}
