import { PaymentsClientError } from '../client';

/**
 * Every refusal the gateway names on the wire (`{ error: <name> }`). The
 * settings screen shows the host's sentence for the code, never the server's
 * `message`, which is developer English. The message still reaches
 * the console and error reporting through the thrown error itself.
 */
export type PaymentsErrorCode =
  | 'AdapterContractError'
  | 'AmbiguousChargeError'
  | 'ApplePayValidationError'
  | 'ChargeDeclinedError'
  | 'ChargeNotPersistedError'
  | 'CredentialsError'
  | 'CustomerRequirementsError'
  | 'InvalidCredentialsInputError'
  | 'IrreversibleChainRemovalError'
  | 'ManualChargeNotFoundError'
  | 'ManualChargeNotPendingError'
  | 'NoProviderSucceededError'
  | 'PaymentsError'
  | 'ProviderChainError'
  | 'ProviderRequestError'
  | 'StubModeRefusedError'
  | 'UnknownProviderError'
  | 'UnprovenProviderError'
  | 'UnsupportedOperationError'
  | 'WebhookVerificationError';

export interface PaymentsFailureCopy {
  /** Any failure with no sentence of its own; `status` is absent when nothing answered. */
  generic(status: number | null): string;
  /** A sentence per code; a code left out falls back to {@link generic}. */
  byCode: Partial<Record<PaymentsErrorCode, string>>;
}

/**
 * The sentence a store owner reads for `error`, in the host's words.
 *
 * - a gateway refusal: its code's sentence, else the generic one with the status;
 * - nothing answered (`fetch` rejects with a `TypeError`): the generic one;
 * - an error a host's own client raised: its message, which the host wrote.
 */
export function describeFailure(error: unknown, copy: PaymentsFailureCopy): string {
  if (error instanceof PaymentsClientError) {
    const byCode = error.code ? copy.byCode[error.code as PaymentsErrorCode] : undefined;
    return byCode ?? copy.generic(error.status);
  }
  if (error instanceof Error && !(error instanceof TypeError) && error.message.trim() !== '') {
    return error.message;
  }
  return copy.generic(null);
}
