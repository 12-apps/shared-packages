// RULE 3 clean counterpart — the shapes the frontend actually uses today: a
// type-only import declaration, inline `type` specifiers, and a type-only
// re-export. None of them emits an import at runtime.
import type { ChargeStatus, ClientChargeView } from '@12-apps/payments-backend';
import { type MerchantRef, type ProviderName } from '@12-apps/payments-backend';

export type { PaymentEnvironment } from '@12-apps/payments-backend';

export type View = ClientChargeView;
export type Status = ChargeStatus;
export type Ref = MerchantRef;
export type Name = ProviderName;
