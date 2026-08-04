import type { ChargeSnapshot, ChargeStatus, Money, PaymentMethodKind, ProviderName } from './types';

/**
 * The client-safe projection of a charge — the ONLY charge shape that may
 * cross the server→client boundary. Deliberately a subset of
 * {@link ChargeSnapshot}: no `raw` provider payload, no decline internals
 * beyond the normalized reason. Server routes build it with
 * {@link toClientChargeView}; the React binding consumes it.
 */
export interface ClientChargeView {
  provider: ProviderName;
  providerChargeId: string;
  status: ChargeStatus;
  amount: Money;
  method: PaymentMethodKind;
  pix?: { qrText: string; qrImageUrl?: string; expiresAt?: string };
  boleto?: { barcode?: string; documentUrl?: string; dueDate?: string };
  card?: { brand?: string; last4?: string };
  hostedCheckoutUrl?: string;
  declineReason?: ChargeSnapshot['declineReason'];
}

export function toClientChargeView(snapshot: ChargeSnapshot): ClientChargeView {
  return {
    provider: snapshot.provider,
    providerChargeId: snapshot.providerChargeId,
    status: snapshot.status,
    amount: snapshot.amount,
    method: snapshot.method,
    pix: snapshot.pix,
    boleto: snapshot.boleto,
    card: snapshot.card
      ? { brand: snapshot.card.brand, last4: snapshot.card.last4 }
      : undefined,
    hostedCheckoutUrl: snapshot.hostedCheckoutUrl,
    declineReason: snapshot.declineReason,
  };
}

/** Charge states the frontend should stop polling on. */
export function isSettled(status: ChargeStatus): boolean {
  return status !== 'PENDING' && status !== 'AUTHORIZED';
}
