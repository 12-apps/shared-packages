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

/** A charge the issuer declined where the scenario expected it paid. */
export function reasonOfStatus(status: string, expected: string): EvidenceFailureReason | undefined {
  return status === 'DECLINED' && expected !== 'DECLINED' ? 'ISSUER_DECLINED' : undefined;
}
